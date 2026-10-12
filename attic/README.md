# Sky Children attic: local-only states preserved at the handover (2026-10-12)

Not part of the theme and not meant to be merged. These are the only states of the Sky Children
work that existed nowhere but in the session's container; they are kept here so nothing is lost.
All three come from the round-1 "polluted worktree" incident (a `git stash pop` in one worktree
pulled another package's work into it). The bow and falls packages were afterwards rebuilt
cleanly (branches sc/bow2, sc/falls2) and merged, so the theme on `main` does not need any of this.

- `stash-on-sc-bow-d5bc86c.patch`: the stash `WIP on sc/bow: d5bc86c` (diff against d5bc86c;
  frame, hours, tsl, world and core: round-1 bow and sky work).
- `wt-bow-dirty-on-d5bc86c.patch`: the uncommitted tree of the old bow worktree (base d5bc86c).
- `wt-falls-dirty-on-1263405.patch`: the uncommitted tree of the old falls worktree (base 1263405),
  stopped in the middle of an unresolved merge: it contains conflict markers.

Apply with `git apply` on a throwaway branch at the named base if anything here is ever wanted.
