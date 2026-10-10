---
layout: Conceptual
monikers:
- msvc-140
- msvc-150
- msvc-160
- msvc-170
- msvc-180
defaultMoniker: msvc-170
versioningType: Ranged
title: Redistribute Visual C++ Files | Microsoft Learn
canonicalUrl: https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files?view=msvc-170
config_moniker_range: '>= msvc-140'
breadcrumb_path: ../_breadcrumb/toc.json
uhfHeaderId: MSDocsHeader-CPP
ROBOTS: INDEX,FOLLOW
manager: coxford
ms.date: 2026-04-13T00:00:00.0000000Z
ms.topic: concept-article
audience: developer
ms.service: visual-cpp
ms.tgt_pltfrm: Windows
ms.workload:
- cplusplus
feedback_system: Standard
feedback_product_url: https://developercommunity.visualstudio.com/cpp/
feedback_help_link_url: https://learn.microsoft.com/en-us/answers/tags/184/windows-app-sdk
feedback_help_link_type: get-help-at-qna
ms.subservice: windows-development
ms.update-cycle: 1825-days
author: TylerMSFT
ms.author: twhitney
description: Learn about Visual Studio Redistributable libraries and components that you can deploy with your app.
locale: en-us
document_id: bfdd5052-e8a5-633e-3c31-74e5ac664917
document_version_independent_id: 1f1321f2-8de8-80a9-fa29-06c71c71d573
updated_at: 2026-04-15T17:42:00.0000000Z
original_content_git_url: https://github.com/MicrosoftDocs/cpp-docs-pr/blob/live/docs/windows/redistributing-visual-cpp-files.md
gitcommit: https://github.com/MicrosoftDocs/cpp-docs-pr/blob/64d64c38a91851deeb0838da6163005e25a15159/docs/windows/redistributing-visual-cpp-files.md
git_commit_id: 64d64c38a91851deeb0838da6163005e25a15159
default_moniker: msvc-170
site_name: Docs
depot_name: VS.vcppdocs
page_type: conceptual
toc_rel: toc.json
pdf_url_template: https://learn.microsoft.com/pdfstore/en-us/VS.vcppdocs/{branchName}{pdfName}
search.mshattr.devlang: cpp
word_count: 1428
asset_id: windows/redistributing-visual-cpp-files
moniker_range_name: 4581682a33ffa46eb75263dee4d6680e
monikers:
- msvc-140
- msvc-150
- msvc-160
- msvc-170
- msvc-180
item_type: Content
source_path: docs/windows/redistributing-visual-cpp-files.md
cmProducts:
- https://authoring-docs-microsoft.poolparty.biz/devrel/4628cbd9-6f47-4ae1-b371-d34636609eaf
spProducts:
- https://authoring-docs-microsoft.poolparty.biz/devrel/be21deb8-8c64-44b0-b71f-2dc56ca7364f
platformId: 2c66bf0c-a50c-de68-16ea-712c38636aa3
---

# Redistribute Visual C++ Files | Microsoft Learn

Note

Are you here because you're looking for a download of one of the Visual C++ Runtime files? Go to the [latest supported Visual C++ Redistributable downloads](latest-supported-vc-redist) page.

## Redistributable files and licensing

Distribution of the Visual C++ Runtime Redistributable package, merge modules, and individual binaries is limited to licensed Visual Studio users and is subject to Microsoft Software License Terms.

When you deploy an application, you must also deploy the files that are required to support it. If Microsoft provides any of these files, check whether you're permitted to redistribute them. You can find a link to the Visual Studio license terms in the IDE. In the **About Microsoft Visual Studio** dialog, select the **License Terms** link. You can also download the relevant Microsoft Software License Terms and licenses from the Visual Studio [License Directory](https://visualstudio.microsoft.com/license-terms/).

::: moniker range="msvc-170"

To view the "REDIST list" that's referenced in the "Distributable Code" section of the Visual Studio 2022 Microsoft Software License Terms, see [Distributable code files for Microsoft Visual Studio 2022](/en-us/visualstudio/releases/2022/redistribution#-distributable-code-files-for-visual-studio-2022).

::: moniker-end

::: moniker range="msvc-160"

To view the "REDIST list" that's referenced in the "Distributable Code" section of the Visual Studio 2019 Microsoft Software License Terms, see [Distributable code files for Microsoft Visual Studio 2019](/en-us/visualstudio/releases/2019/redistribution#-distributable-code-files-for-visual-studio-2019).

::: moniker-end

::: moniker range="msvc-150"

To view the "REDIST list" that's referenced in the "Distributable Code" section of the Visual Studio 2017 Microsoft Software License Terms, see [Distributable code files for Microsoft Visual Studio 2017](/en-us/visualstudio/productinfo/2017-redistribution-vs#-distributable-code-files-for-visual-studio-2017).

::: moniker-end

::: moniker range="msvc-140"

To view the "REDIST list" that's referenced in the "Distributable Code" section of the Visual Studio 2015 Microsoft Software License Terms, see [Distributable code files for Microsoft Visual Studio 2015](/en-us/visualstudio/productinfo/2015-redistribution-vs#-distributable-code-files-for-visual-studio-2015).

::: moniker-end

For more information about redistributable files, see [Determine which dynamic-link libraries (DLLs) to redistribute](determining-which-dlls-to-redistribute) and [Deployment examples](deployment-examples).

## Locate the redistributable files

To deploy redistributable files, you can use the redistributable packages installed by Visual Studio. In versions of Visual Studio since 2017, these files are named `vc_redist.arm64.exe`, `vc_redist.x64.exe`, and `vc_redist.x86.exe`. In Visual Studio 2015, 2017, and 2019, they're also available under the names `vcredist_x86.exe`, `vcredist_x64.exe`, and (2015 only) `vcredist_arm.exe`.

The easiest way to locate the redistributable files is by using environment variables set in a developer command prompt. In Visual Studio 2022, the redistributable files are in the `%VCINSTALLDIR%Redist\MSVC\v143` folder. In the latest version of Visual Studio 2019, you can find the redistributable files in the `%VCINSTALLDIR%Redist\MSVC\v142` folder. In both Visual Studio 2017 and Visual Studio 2019, the files are also found in `%VCToolsRedistDir%`. In Visual Studio 2015, you can find these files in `%VCINSTALLDIR%redist\<locale>`, where `<locale>` is the locale of the redistributable packages.

In Visual Studio 2022 and 2019, merge module files are part of an optional installable component named *Visual C++ &lt;version&gt; Redistributable merge modules* in the Visual Studio Installer. The merge modules are installed by default as part of a C++ install in Visual Studio 2017 and Visual Studio 2015. When they're installed in Visual Studio 2022, you can find the redistributable merge modules in `%VCINSTALLDIR%Redist\MSVC\v143\MergeModules`.

In the latest version of Visual Studio 2019, the redistributable merge modules are found in `%VCINSTALLDIR%Redist\MSVC\v142\MergeModules`. In both Visual Studio 2019 and Visual Studio 2017, they're also found in `%VCToolsRedistDir%MergeModules`. In Visual Studio 2015, they're found in `Program Files [(x86)]\Common Files\Merge Modules`.

## Install the redistributable packages

The Visual C++ Redistributable packages install and register all Visual C++ libraries. If you use one, run it as a prerequisite on the target system before you install your application. We recommend that you use these packages for your deployments because they enable automatic updating of the Visual C++ libraries. For an example that shows how to use these packages, see [Walkthrough: Deploy a Visual C++ application by using the Visual C++ Redistributable package](deploying-visual-cpp-application-by-using-the-vcpp-redistributable-package).

Each Visual C++ Redistributable package checks for the existence of a more recent version on the machine. If a more recent version is found, the package isn't installed. In Visual Studio 2015 or later, redistributable packages display an error message stating that setup failed. If a package uses the `/quiet` flag to run, no error message appears. In either case, the Microsoft installer logs the error, and an error result is returned to the caller.

In Visual Studio 2015 and later, you can avoid this error by checking the registry to find out if a more recent version is installed. The current installed version number is stored in the `HKEY_LOCAL_MACHINE\SOFTWARE\Wow6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\{x86|x64|arm64}` key.

The version number is 14.0 for Visual Studio 2015, 2017, 2019, and 2022 because the latest Redistributable is binary compatible with previous versions back to 2015. The key is `arm64`, `x86`, or `x64` depending on the installed `vcredist` versions for the platform. (You need to check under the `Wow6432Node` subkey only if you use Regedit to view the version of the installed x86 package on an x64 platform.)

The version number is stored in the `REG_SZ` string value `Version` and also in the set of `Major`, `Minor`, `Bld`, and `Rbld``REG_DWORD` values. To avoid an error at installation time, you must skip installation of the redistributable package if the currently installed version is more recent.

### Command-line options for the redistributable packages

The Visual C++ Redistributable supports several command-line options. The `/?`, `/h`, or `/help` options display a dialog that lists the available options. You can specify `/install` to install, `/repair` to repair, or `/uninstall` to uninstall the Redistributable. The `/layout` option copies the complete contents of the Redistributable in the current directory.

By default, the Redistributable installs its contents and prompts the user for information and whether to restart after installation. You can modify this behavior with the following options:

- `/passive`: shows a progress bar as the Redistributable installs but doesn't otherwise require user interaction.
- `/quiet`: doesn't display a user interface or require any user interaction. Use `/quiet` for fully unattended installations.
- `/norestart`: suppresses any attempts to restart. By default, a log file is created in `%TEMP%`.
- `/log filename.txt` to log to a specific file.

If you aren't running from an elevated command prompt, you'll need to respond to a User Account Control prompt to allow the installer to run with administrative privileges.

This example command installs the x64 Redistributable. It shows installation progress but doesn't require user interaction aside from a restart:

```cmd
vc_redist.x64.exe /install /passive /norestart
```

## Install the redistributable merge modules

Important

Merge modules (`.msm` files) for Visual C++ Redistributable files are deprecated. We don't recommend that you use them for application deployment. Instead, we recommend central deployment of the Visual C++ Redistributable package. Central deployment by a redistributable package makes it possible for Microsoft to service runtime library files independently. An uninstall of your app can't affect other applications that also use central deployment.

When you use a redistributable package for central deployment, you aren't responsible for tracking and maintaining the runtime libraries. Otherwise, an update to the runtime library files requires you to update and redeploy your *`.msi`* installer. Your app could be vulnerable to bugs or security issues until you do.

Redistributable merge modules must be included in the Windows Installer package (or similar installation package) that you use to deploy your application. For more information, see [Redistribute by using merge modules](redistributing-components-by-using-merge-modules). For an example, see [Walkthrough: Deploy a Visual C++ application by using a setup project](walkthrough-deploying-a-visual-cpp-application-by-using-a-setup-project).

## Install individual redistributable files

It's also possible to directly install the Redistributable DLLs in the *application local folder*. The application local folder is the folder that contains your executable application file. For servicing reasons, we don't recommend that you use this installation location.

## Potential runtime errors

If Windows can't find one of the Redistributable DLLs required by your application, it might display a message similar to this one: "This application has failed to start because *library*.dll was not found. Reinstalling the application may fix this problem."

To resolve this kind of error, make sure that your application installer builds correctly. Verify that the redistributable libraries get deployed correctly on the target system. For more information, see [Understand the dependencies of a Visual C++ application](understanding-the-dependencies-of-a-visual-cpp-application).