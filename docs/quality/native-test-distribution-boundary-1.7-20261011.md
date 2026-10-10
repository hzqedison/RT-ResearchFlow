# 1.7 native-test and redistribution boundary

The native staging workflow uploads JSON evidence only, never runtime trees,
DLLs, executables, installation archives, or release bundles. Isolated execution
is not public redistribution permission.

The producer binds the exact formal-lock bytes and preparation-policy bytes to
protected native-only authorization before assembly. The native-test assembler
is restricted to an empty, owned rt-preseal directory directly beneath the real
runner temporary root and the current host architecture. It preserves original
manifests and pending license decisions. Original input assets, recipes, runtime
inventory, dependency audits, bootstrap/adapters and post-execution bytes remain
validated. The external supervisor continues owning the process tree.

Ordinary CLI assembly and the independent final seal still require complete
applicable distribution approvals. Native staging cannot select a release output
root, grant license approval, or supply final-release authority. In particular,
the user's lack of a Visual Studio license remains unresolved for Windows public
delivery; this change grants no such entitlement.

Official immutable Git objects may be reused within a process, separately for
each credential identity, under a 48 MiB cache limit. Mutable Actions state is
never cached. Only transport/deadline, HTTP 429 and selected 5xx failures receive
at most two retries. HTTP 401/403/404 and invalid inputs remain failures.

Isolated unit fixtures prove the boundary, not hosted-native or installer success.
