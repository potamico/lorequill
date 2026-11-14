/**
 * English message catalog. The keys are the stable identifiers used in code; other locales must
 * provide exactly the same keys (enforced by the type of `Catalog`). Placeholders look like
 * `{name}` and must be identical in every locale.
 */
export const en = {
  // Folder states shown in the Pages tree
  "folder.profileMissing":
    "No profile found at .lorequill/config.yaml. Managed editing is disabled for this folder.",
  "folder.profileUnsupported":
    "Profile version {found} is not supported; this version of Lorequill supports version {supported}. Managed editing is disabled for this folder.",
  "folder.profileInvalid":
    "The profile is invalid. {detail} Problems in total: {count}. Managed editing is disabled for this folder.",
  "folder.contentRootMissing":
    'The content root "{root}" does not exist or is not a directory. Managed editing is disabled for this folder.',
  "folder.contentRootOutside":
    'The content root "{root}" resolves to a location outside this workspace folder. Managed editing is disabled for this folder.',
  "folder.unsupportedLocation":
    "Lorequill needs a folder on the local file system. Managed editing is disabled for this folder.",
  "folder.scanFailed":
    "The pages could not be read from the content root. Use Refresh to try again.",

  // Page list
  "pages.none": "No pages found. Check content.include and content.exclude in the profile.",
  "pages.noMatch": 'No pages match "{filter}".',
  "pages.truncated":
    "Only the first {limit} files were scanned. Narrow content.include and content.exclude in the profile.",
  "pages.engineMismatch": "CI runs check engine {expected}; this editor has {actual}.",
  "pages.engineMismatchDetail":
    "Checks in the editor and in CI can report different findings. Update Lorequill, or update checks.engine_version in the profile together with the pinned Action.",
  "version.info": "Lorequill {version} · check engine {engine}",
  "version.mismatch": "{folder}: CI runs check engine {expected}.",
  "pages.frontMatterInvalid":
    "The front matter of this page cannot be read; the title comes from the heading or the file name.",
  "pages.draft": "Draft",
  "pages.draftDetail":
    "Draft (content.drafts): checked, but not published. Only other drafts may link here.",
  "pages.filterPrompt": "Filter pages by title, file name, or alias",
  "pages.filterPlaceholder": "Search text",
  "pages.filterActive": "Filter: {filter}",

  // Actions
  "action.openProfile": "Open profile",
  "action.openPage": "Open page",

  // Details of a profile problem
  "profile.problemAtLine": "Line {line}: {message}",
  "profile.problem": "{message}",
  "profile.issue.profile-not-found": "The profile file does not exist.",
  "profile.issue.profile-not-a-file": "The profile path is not a regular file.",
  "profile.issue.profile-outside-workspace":
    "The profile resolves to a location outside this workspace folder.",
  "profile.issue.profile-too-large": "The profile file is larger than the allowed limit.",
  "profile.issue.profile-invalid-encoding": "The profile is not valid UTF-8.",
  "profile.issue.profile-unreadable": "The profile file cannot be read.",
  "profile.issue.profile-empty": "The profile is empty.",
  "profile.issue.yaml-syntax": "The profile contains a YAML syntax error ({yamlCode}).",
  "profile.issue.yaml-duplicate-key": "The profile contains a duplicate key.",
  "profile.issue.yaml-unsupported-construct":
    "The profile uses an unsupported YAML construct ({construct}).",
  "profile.issue.unsupported-version":
    "Profile version {found} is not supported (supported: {supported}).",
  "profile.issue.missing-key": 'The required key "{key}" is missing at {path}.',
  "profile.issue.unknown-key": 'The key "{key}" is not allowed at {path}.',
  "profile.issue.unknown-rule": 'The check rule "{value}" is unknown.',
  "profile.issue.unknown-widget": 'The field widget "{value}" is unknown.',
  "profile.issue.invalid-type": "The value at {path} must be of type {expected}.",
  "profile.issue.invalid-value": "The value at {path} is not allowed ({constraint}).",
  "profile.issue.duplicate-id": 'The ID "{id}" is used more than once ({path}).',
  "profile.issue.duplicate-field-key": 'The field key "{key}" is used more than once ({path}).',
  "profile.issue.invalid-default": "The default value at {path} is not one of the listed options.",
  // Checks (Check Pages) and diagnostics
  "editor.untrusted":
    "This workspace is not trusted, so the Lorequill page editor is not available. Use Open as Text, or trust the workspace.",
  "editor.link.notFound": 'The link target "{target}" was not found.',
  "editor.link.anchorNotFound": 'There is no heading with the anchor "#{anchor}".',
  "editor.link.unsupported": 'Lorequill cannot open the link "{target}".',
  "editor.label.toolbar": "Formatting",
  "editor.label.undo": "Undo",
  "editor.label.redo": "Redo",
  "editor.label.bold": "Bold",
  "editor.label.italic": "Italic",
  "editor.label.strikethrough": "Strikethrough",
  "editor.label.code": "Inline code",
  "editor.label.heading1": "Heading 1",
  "editor.label.heading2": "Heading 2",
  "editor.label.heading3": "Heading 3",
  "editor.label.bullet": "Bulleted list",
  "editor.label.numbered": "Numbered list",
  "editor.label.task": "Task list",
  "editor.label.quote": "Quote",
  "editor.label.codeBlock": "Code block",
  "editor.label.link": "Insert link",
  "editor.label.table": "Insert table",
  "editor.label.horizontalRule": "Horizontal rule",
  "editor.label.source": "Source (show Markdown and front matter)",
  "editor.label.save": "Save",
  "editor.label.checkPages": "Check pages",
  "editor.label.frontMatter": "Properties (front matter)",
  "editor.label.tableHeader1": "Column 1",
  "editor.label.tableHeader2": "Column 2",
  "editor.label.viewModes": "View mode",
  "editor.label.viewEdit": "Edit",
  "editor.label.viewBoth": "Both",
  "editor.label.viewPreview": "Preview",
  "editor.label.previewApproximation":
    "Approximate preview: the published site may look different.",
  "status.position": "Ln {line}, Col {column}",
  "status.words": "{words} words, {minutes} min read",
  "status.saved": "Saved locally",
  "status.unsaved": "Not saved",
  "check.passed": "Editing state checked: {pages} pages, no findings.",
  "check.failed": "Editing state checked: {pages} pages, {findings} findings.",
  "check.incomplete": "The check is incomplete ({reason}). This is not a pass.",
  "check.unavailable":
    "Checks are not available: the workspace is not trusted or no folder has a valid profile.",
  "check.showProblems": "Show Problems",
  "finding.relative-links.empty": "Link destination is empty.",
  "finding.relative-links.absolute-path":
    'Link "{destination}" is an absolute path; use a path relative to this page.',
  "finding.relative-links.unsupported-scheme": 'Link "{destination}" uses an unsupported scheme.',
  "finding.relative-links.outside-content-root": 'Link "{destination}" leaves the content root.',
  "finding.relative-links.backslash": 'Link "{destination}" contains a backslash; use "/" instead.',
  "finding.relative-links.malformed-encoding": 'Link "{destination}" has invalid percent-encoding.',
  "finding.relative-links.missing-target": 'Link target "{target}" does not exist.',
  "finding.relative-links.target-is-draft":
    'Link target "{target}" is a draft and is not published; link to it only from other drafts.',
  "finding.relative-links.target-is-directory":
    'Link target "{target}" is a directory, not a file.',
  "finding.relative-links.target-outside-content-root":
    'Link target "{target}" resolves outside the content root.',
  "finding.relative-links.unsupported-target": 'Link target "{target}" is not a regular file.',
  "finding.relative-links.missing-anchor": 'Anchor "#{anchor}" does not exist in "{target}".',
  "finding.forbidden-text.found": 'Forbidden text "{text}" found.',
  "finding.unique-field.duplicate": 'Value "{value}" of "{field}" is already used in "{first}".',
  "finding.unique-field.not-scalar":
    'Field "{field}" must be a single value to be checked for uniqueness.',
  "finding.allow-values.not-allowed":
    'Value "{value}" after "{marker}" is not allowed; allowed: {allowed}.',
  "finding.field-format.missing": 'Field "{field}" is required here.',
  "finding.field-format.invalid":
    'Value "{value}" of "{field}" must look like {expected} (prefix, hyphen, digits).',
  "finding.reference-field.missing": 'Field "{field}" is required here.',
  "finding.reference-field.unknown":
    'Value "{value}" of "{field}" matches the "{target}" of no page.',
  "finding.reference-field.self": 'Value "{value}" of "{field}" refers to this page itself.',
  "finding.reference-field.not-scalar":
    'Field "{field}" must be a single value or a list of values to refer to pages.',
  "finding.front-matter.invalid": "The front matter cannot be read, so field checks cannot run.",

  // Properties view
  "properties.label.empty": "Open a page of a Lorequill folder to see its properties.",
  "properties.label.readonly":
    "The front matter of this page cannot be edited safely here. Edit it in the source instead.",
  "properties.label.openSource": "Open source",
  "properties.label.collection": "Collection:",
  "properties.label.noCollection":
    "No collection matches this page. All front matter fields are shown.",
  "properties.label.ambiguous":
    "Several collections match this page. The choice only changes which fields are shown.",
  "properties.label.unknownFields": "Other fields",
  "properties.label.required": "Required",
  "properties.label.missing":
    "Required field is missing. This does not block saving or committing.",
  "properties.label.insertDefault": "Insert default:",
  "properties.label.notEditable":
    "This value cannot be edited here without changing its type. Edit it in the source.",
  "properties.label.listHint": "One entry per line.",
  "properties.label.selectNone": "(none)",
  "properties.label.invalidOption": "not an option",
  "properties.label.yes": "yes",
  "properties.conflict":
    "The page changed while the field was being saved. Check the value and try again.",
  "properties.failed": "The field could not be saved: {reason}",
  "properties.rejected": "The value does not fit this field.",
  "properties.problemAtLine": "Line {line}: {message}",
  "frontmatter.issue.yaml-syntax": "The YAML has a syntax error.",
  "frontmatter.issue.yaml-duplicate-key": "A key appears more than once.",
  "frontmatter.issue.yaml-unsupported-construct":
    "The YAML uses a construct Lorequill does not edit (for example a tag, anchor, or alias).",
  "frontmatter.issue.front-matter-not-a-mapping": "The front matter is not a list of fields.",
  "frontmatter.issue.invalid-key": "A field name is empty or contains control characters.",
  "frontmatter.issue.invalid-date": "The date must be a real date written as {expected}.",
  "frontmatter.issue.roundtrip-mismatch":
    "The change would not read back as written, so nothing was saved.",

  // New page
  "newpage.title": "Title of the new page",
  "newpage.inRoot": "The page is created in the content root.",
  "newpage.inDirectory": 'The page is created in "{directory}".',
  "newpage.titleEmpty": "Enter a title.",
  "newpage.fileName": "File name (Dateiname)",
  "newpage.fileName.empty": "Enter a file name.",
  "newpage.fileName.separator":
    "Enter a file name without a folder; the page is created in the chosen folder.",
  "newpage.fileName.invalid-character":
    "The file name contains a character that is not allowed, or starts or ends with a dot or space.",
  "newpage.fileName.reserved": "This file name is reserved by Windows.",
  "newpage.fileName.too-long": "The file name is too long.",
  "newpage.fileName.exists": "A file with this name already exists in this folder.",
  "newpage.chooseFolder": "Folder for the new page",
  "newpage.chooseCollection": "Several collections fit this folder. Which one should the page use?",
  "newpage.failed": 'The page "{name}" could not be created.',
  // Insert Link
  "links.notAPage": "Insert Link works on pages in the content root of a Lorequill folder.",
  "links.pickPage": "Insert Link: choose a page",
  "links.pickPagePlaceholder": "Search by title, path, or alias",
  "links.thisPage": "{title} (this page)",
  "links.aliases": "Aliases: {aliases}",
  "links.pickHeading": "Link to the whole page or to a heading",
  "links.wholePage": "Whole page",
  "links.text": "Link text",
  "links.textEmpty": "Enter a link text.",
  "editor.label.commit": "Commit",
  "review.statusName": "Lorequill review state",
  "review.checkFailed": "Commit check: {findings} findings",
  "review.checkFailedTooltip":
    "The last commit check of the staged state found problems. Click to show them.",
  "review.unverified": "Commit not verified",
  "review.unverifiedTooltip":
    "The committed tree of {commit} differs from the checked tree. Submit is blocked until the commit is checked. Click to check it.",
  "review.verificationFailedTooltip":
    "Commit {commit} has {findings} findings. Make a corrective commit; Submit stays blocked. Click to check again.",
  "review.verified": "Commit checked",
  "review.verifiedTooltip": "Commit {commit} passed the commit check.",
  "commit.chooseFolder": "Commit changes of which folder?",
  "commit.noFolder": "No folder with a valid profile is open.",
  "commit.detached":
    "HEAD is detached. Check out a branch before committing; Lorequill does not commit on a detached HEAD.",
  "commit.conflicted":
    "The repository has merge conflicts. Resolve them in Source Control before committing.",
  "commit.noChanges": "There are no changes to commit.",
  "commit.emptySelection": "Nothing is staged, so there is nothing to commit.",
  "commit.dialogTitle": "Commit on {branch}",
  "commit.dialogPlaceholder":
    "Selected files are staged, cleared files unstaged. Every staged change is committed.",
  "commit.openDiff": "Open changes",
  "commit.mark.staged": "already staged",
  "commit.mark.partial": "partially staged: only the staged part is committed",
  "commit.mark.new": "new",
  "commit.mark.unchecked": "outside the content root, not checked",
  "commit.confirmUnrelated":
    "{count} files outside the content root were already staged. They will be committed too, and the commit check does not cover them.",
  "commit.includeAnyway": "Commit Them Too",
  "commit.checking": "Commit check (staged state)…",
  "commit.verifying": "Checking the committed state…",
  "commit.invalidProfile":
    "The profile in the staged state is invalid, so the staged state cannot be checked. Fix and stage .lorequill/config.yaml.",
  "commit.checkIncomplete":
    "The commit check is incomplete ({reason}). This is not a pass; nothing was committed.",
  "commit.checkFailed": "Commit check (staged state): {findings} findings. Nothing was committed.",
  "commit.showFindings": "Show Findings",
  "commit.findingsTitleStaged": "Commit check (staged state): {findings} findings",
  "commit.findingsTitleCommit": "Check of the committed state: {findings} findings",
  "commit.messageTitle": "Commit message for {branch}",
  "commit.messagePrompt": "Commit check passed ({pages} pages). Every staged change is committed.",
  "commit.messagePromptUntracked":
    "Commit check passed ({pages} pages) with the working-tree profile, because the profile is not tracked. Every staged change is committed.",
  "commit.messageEmpty": "Enter a commit message.",
  "commit.changed":
    "The index or HEAD changed after the commit check. Nothing was committed; run Commit again to check the new state.",
  "commit.failed":
    "Git did not create a commit (exit code {code}). The staged changes are unchanged.",
  "commit.done": "Committed {commit} on {branch}. The commit check passed.",
  "commit.unverified":
    "Commit not verified: the committed tree of {commit} differs from the checked one, for example because a Git hook changed the index. Submit is blocked until the commit is checked.",
  "commit.verifyNow": "Check Commit",
  "commit.verified": "Commit {commit} checked: no findings.",
  "commit.verificationFailed":
    "The committed state has {findings} findings. Make a corrective commit; Submit stays blocked.",
  "git.unavailable.not-ready": "The folder has no valid profile, or the workspace is not trusted.",
  "git.unavailable.git-unavailable":
    "Git is not available. Enable VS Code's built-in Git extension and make sure Git is installed.",
  "git.unavailable.no-repository": "The content root is not inside a Git repository.",
  "git.unavailable.repository-not-open":
    "VS Code's Git extension could not open the repository of the content root.",
  "editor.label.submit": "Submit for review",
  "review.link": "PR #{number}",
  "review.linkTooltip": "Open the pull request of this branch: {url}",
  "links.updatedOnMove": "Links updated in {count} pages after the move.",
  "links.stable.copied": "Stable link copied: {url}",
  "links.stable.notConfigured":
    "The profile defines no stable links. Set site.url and site.stable_links in .lorequill/config.yaml.",
  "links.stable.noValue": "The page has no {field}, so it has no stable link.",
  "links.stable.noPage": "Open or select a page of a Lorequill folder first.",
  "submit.chooseRemote": "Submit to which remote?",
  "submit.confirmTitle": "Submit {branch} for review into {base}?",
  "submit.destination": "Destination: {host} (remote {remote}), {branch} → {base}",
  "submit.newReview": "A new pull request will be created.",
  "submit.updateReview": "The open pull request #{number} ({title}) will be updated.",
  "submit.commitsIntro":
    "The review contains every commit of the branch that is not on the base branch ({count}):",
  "submit.moreCommits": "… and {count} more",
  "submit.stagedNotIncluded":
    "Staged changes that are not committed are not part of the submission.",
  "submit.confirm": "Push and Submit",
  "submit.titlePrompt": "Title of the pull request",
  "submit.titleEmpty": "Enter a title.",
  "submit.openReview": "Open Pull Request",
  "submit.created": "Pull request #{number} created on {host}.",
  "submit.updated": "Branch pushed; pull request #{number} on {host} is updated.",
  "submit.blocked.detached-head": "HEAD is detached. Check out the branch you want to submit.",
  "submit.blocked.unborn-branch": "The branch has no commits yet. Commit first.",
  "submit.branch.title": "Submit your changes on their own branch?",
  "submit.branch.detail":
    "Changes are not submitted directly into {base} but from a branch of their own, so that they can be reviewed first. Lorequill creates the branch from your current state: your commits and uncommitted changes move along. Then submitting continues as usual.",
  "submit.branch.create": "Create Branch",
  "submit.branch.namePrompt": "Name of the new branch",
  "submit.branch.nameHint":
    "A short name for your change, for example update-glossary. Letters, digits, hyphens, and slashes; no spaces.",
  "submit.branch.suggestion": "changes-{date}",
  "submit.branch.empty": "Enter a name.",
  "submit.branch.invalid": "Use only letters, digits, hyphens, and slashes, without spaces.",
  "submit.branch.exists": "A branch {branch} already exists. Choose another name.",
  "submit.branch.failed": "The branch {branch} could not be created.",
  "submit.blocked.unverified":
    "The last commit is not verified. Run Check Commit first; if it reports findings, make a corrective commit.",
  "submit.blocked.conflicts":
    "The repository has merge conflicts. Resolve them in Source Control first.",
  "submit.blocked.no-remote": "The repository has no remote. Add one in Source Control first.",
  "submit.blocked.unsupported-host":
    "The remote is not on a supported Git host. Lorequill submits to github.com and to the GitHub Enterprise Server set in github-enterprise.uri.",
  "submit.blocked.no-push-access": "Your GitHub account cannot push to this repository.",
  "submit.blocked.no-base": "The base branch {base} does not exist on the remote.",
  "submit.blocked.no-commits":
    "The branch has no commits that are not on {base}; there is nothing to submit.",
  "submit.reviewMerged":
    "Pull request #{number} of this branch is already merged. Create a new branch for further changes; Lorequill does not reuse or reopen it.",
  "submit.reviewClosed":
    "Pull request #{number} of this branch was closed. Create a new branch, or reopen it on the host yourself; Lorequill does not reuse or reopen it.",
  "submit.diverged":
    "The remote branch has commits that you do not have. Pull or merge them in Source Control, then submit again. Lorequill never force-pushes.",
  "submit.fetch.auth":
    "Fetching the base branch failed: Git could not authenticate with the remote.",
  "submit.fetch.network": "Fetching the base branch failed: the remote could not be reached.",
  "submit.fetch.failed": "Fetching the base branch failed.",
  "submit.push.auth":
    "The push failed: Git could not authenticate with the remote. Your commits are kept; try again after signing in.",
  "submit.push.network":
    "The push failed: the remote could not be reached. Your commits are kept; try again later.",
  "submit.push.failed": "The push failed. Your commits are kept; you can try again.",
  "submit.pushedRetry": "The branch is pushed; submitting again creates no duplicate.",
  "submit.signInAgain": "Sign In Again",
  "submit.host.auth": "GitHub did not accept the sign-in.",
  "submit.host.forbidden": "GitHub refused the request for this account.",
  "submit.host.not-found": "The repository was not found on GitHub, or your account cannot see it.",
  "submit.host.rate-limited": "GitHub's rate limit is reached. Try again later.",
  "submit.host.network": "GitHub could not be reached.",
  "submit.host.already-exists": "A pull request for this branch exists already.",
  "submit.host.invalid": "GitHub rejected the pull request.",
  "submit.host.unexpected": "GitHub answered unexpectedly.",
} as const;

export type MessageKey = keyof typeof en;
export type Catalog = Readonly<Record<MessageKey, string>>;
