::  /sur/code.hoon
::    Types for %code — git hosting + code collaboration in Drive.
::
::    We store real git objects (content-addressed by SHA-1, exactly as git
::    defines them) so a stock `git` client can clone/fetch/push against a ship.
::    Byte strings are `octs` [length bytes]; bytes are LSB-first (Urbit's
::    native atom byte order), matching cords.
::
|%
::  a git object id: the 20-byte SHA-1, as a big-endian atom (prints like git's
::  hex, e.g. 0xda39.a3ee.5e6b.4b0d.3255.bfef.9560.1890.afd8.0709).
+$  hash  @ux
+$  otype  ?(%blob %tree %commit %tag)
::  a stored object: its git type + raw content bytes (the body only — NOT the
::  "<type> <size>\0" loose header, which is reconstructed for hashing/packing).
+$  gobject  [=otype content=octs]
::  one tree entry: octal mode string (e.g. '100644', '40000'), name, child id.
+$  tree-entry  [mode=@t name=@t =hash]
::  a parsed commit (for building + browsing).
+$  commit
  $:  tree=hash
      parents=(list hash)
      author=@t         ::  "Name <email> <unix-secs> <tz>"
      committer=@t
      message=@t
  ==
::
::  === repositories + collaboration ===================================
::
+$  repo-id    @t                          ::  short name, e.g. 'drive'
+$  code-role  ?(%reader %writer %maintainer %owner)
+$  repo
  $:  name=@t
      description=@t
      objects=(map hash gobject)           ::  the git object store
      refs=(map @t hash)                    ::  'refs/heads/main' → commit id
      head=@t                               ::  symref target, e.g. 'refs/heads/main'
      collaborators=(map @p code-role)      ::  per-repo roster (max'd with space)
      space=(unit @uv)                      ::  the Drive space it belongs to, if any
      public=?                              ::  world-readable clone (no auth)?
      created=@da
      issues=(map @ud issue)
      next-issue=@ud
      pulls=(map @ud pull)
      next-pull=@ud
  ==
::
+$  issue
  $:  num=@ud
      title=@t
      author=@p
      created=@da
      closed=?
      comments=(list comment)
  ==
+$  pull
  $:  num=@ud
      title=@t
      author=@p
      created=@da
      from=@t            ::  source ref (e.g. 'refs/heads/feature')
      into=@t            ::  target ref (e.g. 'refs/heads/main')
      state=?(%open %merged %closed)
      comments=(list comment)
  ==
+$  comment  [author=@p at=@da text=@t]
::
::  actions from the browser (POST /code/action)
+$  action
  $%  [%create-repo name=@t description=@t public=?]
      [%delete-repo name=@t]
      [%set-collaborator name=@t who=@p role=code-role]
      [%remove-collaborator name=@t who=@p]
      ::  create a commit on a branch from a set of file edits (browser-side
      ::  editing / import), building blob+tree+commit objects server-side.
      [%commit-files name=@t branch=@t message=@t files=(list [path=@t body=@t])]
      [%open-issue name=@t title=@t]
      [%comment-issue name=@t num=@ud text=@t]
      [%close-issue name=@t num=@ud]
      [%open-pull name=@t title=@t from=@t into=@t]
      [%comment-pull name=@t num=@ud text=@t]
      [%merge-pull name=@t num=@ud]
  ==
--
