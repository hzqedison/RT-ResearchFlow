#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <node_api.h>

namespace {
constexpr DWORD kPacketSize = 34;
constexpr ULONGLONG kDeadlineMs = 15000;

napi_value Reject(napi_env env) {
  napi_throw_error(env, nullptr, "WINDOWS_REPAIR_STDIN_REJECTED");
  return nullptr;
}

napi_value ReadInheritedAnonymousStdin(napi_env env, napi_callback_info) {
  // The reviewed NSIS launcher creates an anonymous pipe and makes its read
  // end the ONLY inherited stdin handle. GetFileType alone does not distinguish
  // named pipes; direct-parent/installer-image validation remains mandatory.
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  if (input == nullptr || input == INVALID_HANDLE_VALUE || GetFileType(input) != FILE_TYPE_PIPE) return Reject(env);
  BYTE packet[kPacketSize] = {};
  const ULONGLONG deadline = GetTickCount64() + kDeadlineMs;
  DWORD available = 0;
  for (;;) {
    if (!PeekNamedPipe(input, nullptr, 0, nullptr, &available, nullptr)) return Reject(env);
    if (available >= kPacketSize) break;
    if (GetTickCount64() >= deadline) return Reject(env);
    Sleep(5);
  }
  DWORD received = 0;
  while (received < kPacketSize) {
    DWORD count = 0;
    if (!ReadFile(input, packet + received, kPacketSize - received, &count, nullptr) || count == 0) return Reject(env);
    received += count;
  }
  if (packet[0] != 1 || packet[1] != 1) return Reject(env);
  bool nonzero = false;
  for (DWORD i = 2; i < kPacketSize; ++i) nonzero |= packet[i] != 0;
  if (!nonzero) return Reject(env);
  for (;;) {
    available = 0;
    if (!PeekNamedPipe(input, nullptr, 0, nullptr, &available, nullptr)) {
      if (GetLastError() != ERROR_BROKEN_PIPE) return Reject(env);
      break;
    }
    if (available != 0 || GetTickCount64() >= deadline) return Reject(env);
    Sleep(5);
  }
  napi_value result, kind, bytes, eof;
  if (napi_create_object(env, &result) != napi_ok ||
      napi_create_string_utf8(env, "win32-inherited-anonymous-stdin-v1", NAPI_AUTO_LENGTH, &kind) != napi_ok ||
      napi_create_buffer_copy(env, kPacketSize, packet, nullptr, &bytes) != napi_ok ||
      napi_get_boolean(env, true, &eof) != napi_ok ||
      napi_set_named_property(env, result, "kind", kind) != napi_ok ||
      napi_set_named_property(env, result, "packet", bytes) != napi_ok ||
      napi_set_named_property(env, result, "eof", eof) != napi_ok) return Reject(env);
  SecureZeroMemory(packet, sizeof(packet));
  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor descriptor = {"readInheritedAnonymousStdin", nullptr, ReadInheritedAnonymousStdin,
    nullptr, nullptr, nullptr, napi_default, nullptr};
  if (napi_define_properties(env, exports, 1, &descriptor) != napi_ok) return Reject(env);
  return exports;
}
}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
