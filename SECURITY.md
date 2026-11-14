# Security Policy

## Supported versions

Security fixes are provided for the latest release only. Lorequill stays at 0.x until the MVP
acceptance; a fix comes as a new patch version, not as a backport.

## Reporting a vulnerability

Please do **not** report security vulnerabilities through public issues, discussions, or pull
requests.

Report them privately using GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on [potamico/lorequill](https://github.com/potamico/lorequill/security) (the **Security** tab,
then **Report a vulnerability**).

Please include:

- A description of the issue and its potential impact.
- Steps to reproduce, or a minimal proof of concept.
- The affected version or commit, and your VS Code, Node.js, and operating system versions.

Do not include confidential documents or credentials in your report.

## What to expect

- We aim to acknowledge reports within 5 working days.
- We will investigate, keep you informed of progress, and coordinate a fix and disclosure timeline
  with you.
- We will credit reporters in the release notes unless they prefer to remain anonymous.

## Scope

Lorequill treats Markdown, YAML front matter, repository profiles, and webview messages as
untrusted input. Examples of in-scope issues:

- Path traversal or symlink escape outside the configured content root.
- Execution of repository-supplied code, commands, or regular expressions.
- Webview content-security-policy bypasses or malicious webview messages reaching the file system.
- Unintended Git operations (implicit staging, resets, force pushes) or credential exposure.
- Leakage of page content, front matter values, or tokens into logs.

The extension does not transmit telemetry. Host API requests occur only for explicit review
actions. See the specification, section 15, for the full security and privacy requirements.
