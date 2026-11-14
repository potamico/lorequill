# Commit, submit, and Git hooks

This page describes how Lorequill's **Commit** (`Commit`) and **Submit for review**
(`Submit for Review`) work with Git and GitHub, and how checks differ from Git hooks. The specification (§7, §12) is authoritative; this page explains the behavior to
authors and repository maintainers.

## What Commit does

1. **Choose files.** The dialog lists every changed file of the repository. Files that are already
   staged are selected and marked _already staged_, by whichever tool staged them. Selecting a file
   stages the whole file; clearing it unstages the whole file. A partially staged file stays as it
   is: only its staged part is committed, the rest stays unstaged. Every staged change is
   committed, including files outside the content root, which are marked _not checked_. If such
   files were staged before the dialog opened and stay selected, Commit asks for explicit
   confirmation.
2. **Commit check.** Lorequill checks the staged tree: exactly what the commit will contain, read
   from Git's index. Unsaved editor buffers and unstaged working-tree changes are not part of it,
   unlike `Check Pages`, which checks the editing state. The profile is read from the staged
   tree as well, so the result matches what CI computes for the commit; only if
   `.lorequill/config.yaml` is not tracked is the working-tree profile used. Findings block the
   commit; they never block Save.
3. **Message.** An editable default message (`docs: update content`, in the profile's locale).
4. **Commit.** Lorequill first verifies that neither `HEAD` nor the staged tree changed since the
   check; otherwise it commits nothing and asks for a new run. Then it runs an ordinary
   `git commit` with the approved message. Git's configured identity, signing, and hooks apply as
   for any other commit.
5. **Verification.** Lorequill compares the tree of the new commit with the checked tree.

Lorequill never stages, unstages, resets, or discards anything on its own, never switches
branches, and never rewrites a commit. It does not commit on a detached `HEAD` or while the index
has merge conflicts.

## Git hooks are not checks

The commit check is Lorequill's declarative check engine. It never runs code from the
repository: it reads Git objects only, without filters, hooks, or a file system monitor.

`git commit` itself runs the repository's normal hooks (`pre-commit`, `commit-msg`,
`post-commit`, and others), exactly as on the command line. They are configured locally, not by
Lorequill or the profile, and Lorequill does not control what they do:

- **A hook rejects the commit.** Git creates no commit. Lorequill shows Git's message, including
  the hook's output, and leaves the staged changes as they are.
- **A hook changes the index**, for example by formatting files and staging the result. The
  commit then contains a tree that was not checked. Lorequill reports **Commit not verified**
  in the status bar and blocks Submit. **Check Commit**
  checks the committed tree; if it passes, the state is cleared. If it fails, make a corrective
  commit. Lorequill never undoes or amends the commit.
- **A hook has other side effects**, such as changing working-tree files. These appear in VS
  Code's refreshed Git status like any other change.

A passing commit check verifies content identity with what was checked, not that CI passes; CI
remains the authoritative check of the pushed branch and may run further checks.

## Submit for review

**Submit for Review** pushes the current branch and creates a GitHub
pull request, or updates the open one of the same branch:

1. It refuses to submit from a detached `HEAD`, from a branch without commits, with merge
   conflicts, or while the last commit is **not verified**. It never submits from the base
   branch (`review.base_branch`, or the repository's default branch): there, after fetching it and
   finding commits to submit, it explains that changes are submitted from their own branch and
   offers to create one at `HEAD`, with a name suggested from the single commit's subject or the
   date. With consent, it creates and checks out the branch (commits and uncommitted changes move
   along) and continues with it. The local base branch then moves back to the remote base branch,
   because its own commits are on the new branch, so pulling after the merge never diverges. It
   moves only if both branches still point at the commit it branched from, atomically; the reflog
   keeps the old position.
2. It uses the remote of the branch's upstream, otherwise `origin`, otherwise asks. The remote must
   be on github.com or on the GitHub Enterprise Server set in `github-enterprise.uri`, and your
   account must be able to push to it. Fork workflows are not supported yet.
3. It fetches the base branch and lists every commit of the branch that is not on it: a pull
   request contains all of them, not only the last commit. It shows the destination, whether a
   pull request is created or updated, and the commits, and asks for confirmation.
4. It pushes through VS Code's Git extension, with your Git credentials, never with force. A
   diverged remote branch is reported; pull or merge in Source Control and submit again.
5. It creates the pull request, or reuses the open one. A pull request of the same branch that was
   closed or merged is never reopened or reused; use a new branch.

Signing in to GitHub happens through VS Code's own GitHub account, only when you submit. A failed
push or request leaves your commits as they are, and submitting again never creates a duplicate.
Lorequill never merges, deletes branches, rebases, or force-pushes, and resets nothing except the
local base branch after branching off as described in step 1, where no commit is lost.

## Status bar

The Lorequill status bar item shows the review state of the repository you work in: _Commit
checked_, _Commit check: n findings_ (after a blocked commit), **Commit not verified**, or the
pull request of the current branch (_PR #n_, which opens it). The
current branch and pending changes stay in VS Code's own Git status bar item and Source Control
view. The unverified state is kept across restarts until the committed tree is checked.
