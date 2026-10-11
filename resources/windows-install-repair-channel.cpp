#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0601
#include <windows.h>
#include <bcrypt.h>
#include <shellapi.h>
#include <wchar.h>
#include <string>
#include <vector>

#ifndef RT_REPAIR_CHANNEL_PATH_PROBE
static_assert(sizeof(void*) == 4, "NSIS launcher must be a 32-bit Unicode plug-in");
#endif
struct stack_t { stack_t* next; wchar_t text[1]; };

namespace {
struct Handle {
  HANDLE value = nullptr;
  ~Handle() { if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
};

bool Pop(stack_t** top, int stringSize, std::wstring& value) {
  if (!top || !*top || stringSize < 2 || stringSize > 32768) return false;
  stack_t* row = *top;
  *top = row->next;
  int length = 0;
  while (length < stringSize && row->text[length]) ++length;
  const bool good = length < stringSize;
  if (good) value.assign(row->text, length);
  GlobalFree(row);
  return good;
}

void Push(stack_t** top, const wchar_t* value) {
  if (!top) return;
  const SIZE_T length = wcslen(value);
  stack_t* row = static_cast<stack_t*>(GlobalAlloc(GPTR, sizeof(stack_t) + (length + 1) * sizeof(wchar_t)));
  if (!row) return;
  memcpy(row->text, value, (length + 1) * sizeof(wchar_t));
  row->next = *top;
  *top = row;
}

bool ExactRepairSwitch() {
  int count = 0;
  wchar_t** argv = CommandLineToArgvW(GetCommandLineW(), &count);
  if (!argv) return false;
  bool found = false;
  for (int i = 1; i < count; ++i) found |= _wcsicmp(argv[i], L"/RTRepair") == 0;
  LocalFree(argv);
  return found;
}

bool CanonicalDK(const std::wstring& value) {
  if (value.size() < 4 || (towupper(value[0]) != L'D' && towupper(value[0]) != L'K') ||
      value[1] != L':' || value[2] != L'\\' || value.back() == L'\\') return false;
  for (wchar_t ch : value) if (ch < 32 || ch == L'"' || ch == L'/') return false;
  wchar_t full[32768] = {};
  DWORD size = GetFullPathNameW(value.c_str(), 32768, full, nullptr);
  return size > 0 && size < 32768 && _wcsicmp(full, value.c_str()) == 0;
}

bool CanonicalInstallerPath(const std::wstring& value) {
  // The signed installer can be launched from Downloads on any local drive.
  // Only the reviewed payload, runtime and job paths are restricted to D/K.
  if (value.size() < 4 ||
      !((value[0] >= L'A' && value[0] <= L'Z') ||
        (value[0] >= L'a' && value[0] <= L'z')) ||
      value[1] != L':' || value[2] != L'\\' || value.back() == L'\\') return false;
  for (size_t i = 0; i < value.size(); ++i) {
    const wchar_t ch = value[i];
    if (ch < 32 || ch == L'"' || ch == L'/' || ch == L'<' ||
        ch == L'>' || ch == L'|' || ch == L'?' || ch == L'*' ||
        (ch == L':' && i != 1)) return false;
  }
  wchar_t full[32768] = {};
  DWORD size = GetFullPathNameW(value.c_str(), 32768, full, nullptr);
  return size > 0 && size < 32768 && _wcsicmp(full, value.c_str()) == 0;
}

std::wstring Quote(const std::wstring& value) { return L"\"" + value + L"\""; }

void AppendEnv(std::wstring& block, const wchar_t* key, const std::wstring& value) {
  block.append(key).append(L"=").append(value);
  block.push_back(L'\0');
}

int LaunchReviewed(const std::wstring (&a)[10]) {
  // NSIS must call this only after its explicit repair consent branch; the
  // plug-in independently requires the exact /RTRepair command-line token.
  if (a[0] != L"1" || !ExactRepairSwitch()) return 23;
  for (int i = 1; i < 10; ++i) if (!CanonicalDK(a[i])) return 23;
  const std::wstring& node = a[1];
  const std::wstring& consumer = a[2];
  const std::wstring& receipt = a[3];
  const std::wstring& signature = a[4];
  const std::wstring& programRoot = a[5];
  const std::wstring& runtimeSeal = a[6];
  const std::wstring& privateNode = a[7];
  const std::wstring& nativeHost = a[8];
  const std::wstring& jobHost = a[9];
  const bool ownedRoot = _wcsicmp(programRoot.c_str(),
      L"D:\\RT-ResearchFlow-BuildCache\\windows-repair-owned-1.7\\payload") == 0 ||
    _wcsicmp(programRoot.c_str(),
      L"K:\\RT-ResearchFlow-BuildCache\\windows-repair-owned-1.7\\payload") == 0;
  if (!ownedRoot || _wcsicmp(node.c_str(), privateNode.c_str()) != 0 ||
      consumer.size() <= programRoot.size() ||
      _wcsnicmp(consumer.c_str(), programRoot.c_str(), programRoot.size()) != 0 ||
      consumer[programRoot.size()] != L'\\') return 23;
  wchar_t installer[32768] = {};
  DWORD installerLength = GetModuleFileNameW(nullptr, installer, 32768);
  if (!installerLength || installerLength >= 32768 || !CanonicalInstallerPath(installer)) return 23;
  wchar_t windowsRoot[32768] = {};
  DWORD rootLength = GetWindowsDirectoryW(windowsRoot, 32768);
  if (!rootLength || rootLength >= 32768) return 23;
  const std::wstring base = programRoot.substr(0, programRoot.size() - 8); // remove "\\payload"
  const std::wstring jobCache = base + L"\\job";
  std::wstring environment;
  AppendEnv(environment, L"SystemRoot", windowsRoot);
  AppendEnv(environment, L"WINDIR", windowsRoot);
  AppendEnv(environment, L"TEMP", jobCache);
  AppendEnv(environment, L"TMP", jobCache);
  environment.push_back(L'\0');
  std::wstring command = Quote(node) + L" " + Quote(consumer) +
    L" --receipt " + Quote(receipt) + L" --signature " + Quote(signature) +
    L" --installer " + Quote(installer) + L" --program-root " + Quote(programRoot) +
    L" --runtime-seal " + Quote(runtimeSeal) + L" --private-node " + Quote(privateNode) +
    L" --native-host " + Quote(nativeHost) + L" --job-host " + Quote(jobHost);
  if (command.size() >= 32767) return 23;
  std::vector<wchar_t> mutableCommand(command.begin(), command.end());
  mutableCommand.push_back(L'\0');
  SECURITY_ATTRIBUTES security = {sizeof(security), nullptr, TRUE};
  Handle pipeRead, pipeWrite, nullOutput, job, child, thread;
  if (!CreatePipe(&pipeRead.value, &pipeWrite.value, &security, 0) ||
      !SetHandleInformation(pipeWrite.value, HANDLE_FLAG_INHERIT, 0)) return 23;
  nullOutput.value = CreateFileW(L"NUL", GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
    &security, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (nullOutput.value == INVALID_HANDLE_VALUE) return 23;
  SIZE_T attributeBytes = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &attributeBytes);
  if (!attributeBytes) return 23;
  std::vector<BYTE> attributeStorage(attributeBytes);
  auto* attributes = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributeStorage.data());
  if (!InitializeProcThreadAttributeList(attributes, 1, 0, &attributeBytes)) return 23;
  HANDLE inherited[2] = {pipeRead.value, nullOutput.value};
  const bool attributeReady = UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
    inherited, sizeof(inherited), nullptr, nullptr) != FALSE;
  if (!attributeReady) { DeleteProcThreadAttributeList(attributes); return 23; }
  STARTUPINFOEXW startup = {};
  startup.StartupInfo.cb = sizeof(startup);
  startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  startup.StartupInfo.hStdInput = pipeRead.value;
  startup.StartupInfo.hStdOutput = nullOutput.value;
  startup.StartupInfo.hStdError = nullOutput.value;
  startup.lpAttributeList = attributes;
  job.value = CreateJobObjectW(nullptr, nullptr);
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limit = {};
  limit.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  bool started = job.value && SetInformationJobObject(job.value, JobObjectExtendedLimitInformation,
    &limit, sizeof(limit));
  PROCESS_INFORMATION process = {};
  if (started) started = CreateProcessW(node.c_str(), mutableCommand.data(), nullptr, nullptr, TRUE,
    CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
    environment.data(), programRoot.c_str(), &startup.StartupInfo, &process) != FALSE;
  DeleteProcThreadAttributeList(attributes);
  if (!started) return 23;
  child.value = process.hProcess;
  thread.value = process.hThread;
  if (!AssignProcessToJobObject(job.value, child.value) || ResumeThread(thread.value) == DWORD(-1)) return 23;
  BYTE packet[34] = {1, 1};
  bool sent = BCryptGenRandom(nullptr, packet + 2, 32, BCRYPT_USE_SYSTEM_PREFERRED_RNG) >= 0;
  DWORD offset = 0;
  while (sent && offset < sizeof(packet)) {
    DWORD written = 0;
    sent = WriteFile(pipeWrite.value, packet + offset, sizeof(packet) - offset, &written, nullptr) != FALSE && written > 0;
    offset += written;
  }
  SecureZeroMemory(packet, sizeof(packet));
  CloseHandle(pipeWrite.value);
  pipeWrite.value = nullptr;
  CloseHandle(pipeRead.value);
  pipeRead.value = nullptr;
  if (!sent) return 23;
  if (WaitForSingleObject(child.value, 20 * 60 * 1000) != WAIT_OBJECT_0) return 23;
  DWORD exitCode = 23;
  return GetExitCodeProcess(child.value, &exitCode) && exitCode == 0 ? 0 : 23;
}
}  // namespace

extern "C" __declspec(dllexport) void __cdecl Launch(
  HWND, int string_size, wchar_t*, stack_t** stacktop, void*) {
  std::wstring args[10];
  bool valid = string_size >= 2 && string_size <= 32768;
  for (int i = 0; valid && i < 10; ++i) valid = Pop(stacktop, string_size, args[i]);
  Push(stacktop, valid && LaunchReviewed(args) == 0 ? L"0" : L"23");
}

#ifdef RT_REPAIR_CHANNEL_PATH_PROBE
#include <node_api.h>
int PathProbeResult() {
  const std::wstring download = L"C:\\Users\\test\\Downloads\\RT-ResearchFlow-Setup.exe";
  if (!CanonicalInstallerPath(download)) return 1;
  if (CanonicalDK(download)) return 2;
  if (!CanonicalDK(L"D:\\RT-ResearchFlow-BuildCache\\windows-repair-owned-1.7\\payload")) return 3;
  if (CanonicalInstallerPath(L"relative.exe")) return 4;
  if (CanonicalInstallerPath(L"C:\\Downloads\\bad.exe:stream")) return 5;
  return 0;
}
napi_value CheckPathProbe(napi_env env, napi_callback_info) {
  napi_value result;
  napi_create_int32(env, PathProbeResult(), &result);
  return result;
}
napi_value InitPathProbe(napi_env env, napi_value exports) {
  napi_value check;
  napi_create_function(env, "check", NAPI_AUTO_LENGTH, CheckPathProbe, nullptr, &check);
  napi_set_named_property(env, exports, "check", check);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, InitPathProbe)
#endif
