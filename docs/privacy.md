# Privacy notice

Lorequill is a local VS Code extension and a check engine for CI. It has no servers of its own and
collects no telemetry.

## In the editor

- **Your files stay local.** Lorequill reads and writes files only in the workspace folders you
  open. Pages are saved through VS Code's normal save.
- **Network access.** Lorequill contacts a Git host only when you run **Submit for review**.
  The push goes through VS Code's Git extension with your Git credentials. Creating or finding the
  pull request uses the GitHub REST API of the remote's host (github.com or your configured GitHub
  Enterprise Server) through VS Code's GitHub sign-in. External links in pages are never fetched.
- **Credentials.** Tokens come from VS Code's authentication providers. Lorequill sends them only
  to the API of the verified host, and never stores or logs them. The profile cannot contain
  credentials.
- **Logs.** The _Lorequill_ output channel contains operational metadata only: events, states,
  counts, and folder numbers. It never contains page text, front matter values, file or folder
  names, tokens, or full finding messages. Git and hook output is shown to you when a commit or
  push fails, but it is not logged.
- **Stored state.** VS Code's workspace storage keeps the review state of each repository (the
  last verified or unverified commit) and the link to the submitted pull request of a branch. It
  stays on your machine.

## In CI

The Lorequill checks Action runs inside your GitHub Actions workflow. It reads the checked-out
files and sends nothing anywhere. Its log, the job summary, the pull request annotations, and an
optional SARIF file contain finding locations and messages, and messages can quote page content
such as a link destination or a front matter value. Who can see them follows the visibility of
your repository and its Actions logs and code scanning results on GitHub. SARIF is uploaded only
if your workflow does so.

## Pull requests

**Submit for review** creates a pull request whose title you confirm and whose description lists
the subjects of the submitted commits. The pull request is subject to your Git host's terms and
privacy policy.

Questions or concerns: see the [security policy](https://github.com/potamico/lorequill/security/policy) for private reports, or open an issue.
