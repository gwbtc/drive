::  /app/code.hoon
::    %code — git hosting + code collaboration in Drive. Serves git smart-HTTP
::    under /code so a stock `git` client can clone a repo the ship hosts, and
::    stores real git objects (SHA-256 format; see /lib/git.hoon). Repos are
::    populated from the browser (create-repo + commit-files), building
::    blob/tree/commit objects server-side. All git hashing runs in poke /
::    HTTP-handler context (jetted crypto is unavailable in a gall scry).
::
/-  *code
/+  git, default-agent, dbug, server, schooner
|%
+$  card  card:agent:gall
+$  versioned-state  $%(state-0)
+$  state-0  [%0 repos=(map @t repo)]
--
%-  agent:dbug
=|  state-0
=*  state  -
^-  agent:gall
=<
|_  =bowl:gall
+*  this  .
    def  ~(. (default-agent this %.n) bowl)
    cor  ~(. +> [bowl state])
++  on-init
  ^-  (quip card _this)
  =^  cards  state  init:cor
  [cards this]
++  on-save  !>(state)
++  on-load
  |=  old=vase
  ^-  (quip card _this)
  =^  cards  state  (load:cor old)
  [cards this]
++  on-poke
  |=  [=mark =vase]
  ^-  (quip card _this)
  =^  cards  state  (handle-poke:cor mark vase)
  [cards this]
++  on-peek   peek:cor
::  eyre subscribes on /http-response/<eyre-id> to receive our reply; accept it
::  (default-agent would crash on the unknown path → HTTP 500).
++  on-watch
  |=  =path
  ^-  (quip card _this)
  ?+  path  (on-watch:def path)
    [%http-response *]  `this
  ==
++  on-leave  |=(path `this)
++  on-agent  on-agent:def
::  ignore arvo signs (eyre's %connect ack arrives on /eyre/connect).
++  on-arvo   |=([wire sign-arvo] `this)
++  on-fail   on-fail:def
--
::
|_  [=bowl:gall state=state-0]
+*  repos  repos.state
++  init
  ^-  (quip card _state)
  :_  state
  :~  [%pass /eyre/connect %arvo %e %connect [~ /code] %code]
  ==
++  load
  |=  old=vase
  ^-  (quip card _state)
  :_  !<(state-0 old)
  :~  [%pass /eyre/connect %arvo %e %connect [~ /code] %code]
  ==
++  handle-poke
  |=  [=mark =vase]
  ^-  (quip card _state)
  ?+  mark  `state
      %handle-http-request
    =+  !<([eyre-id=@ta =inbound-request:eyre] vase)
    (handle-http eyre-id inbound-request)
    ::
      %code-action
    ?>  =(src.bowl our.bowl)
    (handle-action !<(action vase))
  ==
++  peek
  |=  =path
  ^-  (unit (unit cage))
  ?+  path  ~
      [%x %repos ~]
    ``json+!>(a+(turn ~(val by repos) repo-summary))
  ==
++  repo-summary
  |=  r=repo
  ^-  json
  =,  enjs:format
  =/  branches=(list @t)  ~(tap in ~(key by refs.r))
  %-  pairs
  :~  name+s+name.r
      description+s+description.r
      public+b+public.r
      head+s+head.r
      objects+(numb ~(wyt by objects.r))
      branches+a+(turn branches |=(b=@t s+b))
  ==
::
::  === actions: create-repo + commit-files ==========================
::
++  handle-action
  |=  =action
  ^-  (quip card _state)
  ?-  -.action
      %create-repo
    =/  r=repo
      :*  name.action  description.action
          objects=~  refs=~  head='refs/heads/main'
          collaborators=(malt ~[[our.bowl %owner]])
          space=~  public.action  now.bowl
          issues=~  next-issue=1  pulls=~  next-pull=1
      ==
    `state(repos (~(put by repos) name.action r))
    ::
      %commit-files
    =/  r  (~(get by repos) name.action)
    ?~  r  `state
    `state(repos (~(put by repos) name.action (do-commit u.r branch.action message.action files.action)))
    ::
      %delete-repo  `state(repos (~(del by repos) name.action))
      %set-collaborator
    =/  r  (~(get by repos) name.action)
    ?~  r  `state
    `state(repos (~(put by repos) name.action u.r(collaborators (~(put by collaborators.u.r) who.action role.action))))
      %remove-collaborator
    =/  r  (~(get by repos) name.action)
    ?~  r  `state
    `state(repos (~(put by repos) name.action u.r(collaborators (~(del by collaborators.u.r) who.action))))
    ::  collaboration actions (issues/PRs) — data-model stubs for follow-up.
      ?(%open-issue %comment-issue %close-issue %open-pull %comment-pull %merge-pull)
    `state
  ==
::  Build blob+tree+commit objects for a set of (flat) files and advance a
::  branch. First commit has no parent; later commits chain off the branch tip.
++  do-commit
  |=  [r=repo branch=@t message=@t files=(list [path=@t body=@t])]
  ^-  repo
  =/  now-secs=@ud  (div (sub now.bowl ~1970.1.1) ~s1)
  =/  secs=tape  (trip (deci:git now-secs))
  =/  who=@t  (crip "{(scow %p our.bowl)} <{(scow %p our.bowl)}@drive> {secs} +0000")
  ::  a blob per file → tree entries; thread BOTH the entries and the object
  ::  store through the fold (a bare `=.` inside `roll` wouldn't persist).
  =/  built
    %+  roll  files
    |=  $:  f=[path=@t body=@t]
            acc=[entries=(list tree-entry) objs=(map hash gobject)]
        ==
    =/  blob  (build-blob:git (cord-octs:git body.f))
    :-  [['100644' path.f -.blob] entries.acc]
    (~(put by objs.acc) -.blob +.blob)
  =/  entries  entries.built
  ::  merge the new blobs with the repo's existing objects (prior commits)
  =/  objs  (~(uni by objects.r) objs.built)
  =/  tree  (build-tree:git entries)
  =.  objs  (~(put by objs) -.tree +.tree)
  =/  ref-name=@t  (crip "refs/heads/{(trip branch)}")
  =/  parent  (~(get by refs.r) ref-name)
  =/  =commit:git
    :*  tree=-.tree
        parents=?~(parent ~ ~[u.parent])
        author=who  committer=who  message=message
    ==
  =/  cmt  (build-commit:git commit)
  =.  objs  (~(put by objs) -.cmt +.cmt)
  %=  r
    objects  objs
    refs     (~(put by refs.r) ref-name -.cmt)
    head     ref-name
  ==
::
::  === dejs (parse action JSON from POST /code/action) ==============
::
++  dejs-action
  =,  dejs:format
  ^-  $-(json action)
  =/  p-fist  (su fed:ag)
  =/  cr-fist  ^-($-(json code-role) (su (perk %reader %writer %maintainer %owner ~)))
  =/  files-fist
    ^-  $-(json (list [path=@t body=@t]))
    (ar (ot ~[path+so body+so]))
  %-  of
  :~  [%create-repo (ot ~[name+so description+so public+bo])]
      [%delete-repo (ot ~[name+so])]
      [%set-collaborator (ot ~[name+so who+p-fist role+cr-fist])]
      [%remove-collaborator (ot ~[name+so who+p-fist])]
      [%commit-files (ot ~[name+so branch+so message+so files+files-fist])]
  ==
::
::  === HTTP: git smart-HTTP + actions + self-test ===================
::
++  handle-http
  |=  [eyre-id=@ta =inbound-request:eyre]
  ^-  (quip card _state)
  =/  ,request-line:server
    (parse-request-line:server url.request.inbound-request)
  =+  send=(cury response:schooner eyre-id)
  ?.  ?=([%code *] site)
    [(send [404 ~ [%plain "not found"]]) state]
  =/  rest  t.site
  ::  liveness + self-test (see git-selftest below).
  ?:  ?=([%ping ~] rest)
    [(send [200 ~ [%plain "pong"]]) state]
  ?:  ?=([%git-selftest ~] rest)
    [(send [200 ~ [%plain selftest-body]]) state]
  ::  POST /code/action — create-repo / commit-files / …
  ?:  ?=([%action ~] rest)
    ?.  =('POST' method.request.inbound-request)
      [(send [405 ~ [%plain "POST only"]]) state]
    ?~  body.request.inbound-request
      [(send [400 ~ [%plain "body required"]]) state]
    =/  jon  (de:json:html q.u.body.request.inbound-request)
    ?~  jon  [(send [400 ~ [%plain "bad json"]]) state]
    =^  cards  state  (handle-action (dejs-action u.jon))
    [(weld cards (send [200 ~ [%json (pairs:enjs:format ~[ok+b+&])]])) state]
  ::  --- git smart-HTTP (clone/fetch) ---
  ::  GET /code/<repo>/info/refs?service=git-upload-pack
  ?:  ?=([@ %info %refs ~] rest)
    =/  r  (~(get by repos) i.rest)
    ?~  r  [(send [404 ~ [%plain "no such repo"]]) state]
    :_  state
    %^    git-reply  eyre-id  'application/x-git-upload-pack-advertisement'
    (info-refs-upload u.r)
  ::  POST /code/<repo>/git-upload-pack
  ?:  ?=([@ %git-upload-pack ~] rest)
    =/  r  (~(get by repos) i.rest)
    ?~  r  [(send [404 ~ [%plain "no such repo"]]) state]
    :_  state
    %^    git-reply  eyre-id  'application/x-git-upload-pack-result'
    (upload-pack u.r)
  [(send [404 ~ [%plain "not found"]]) state]
::  Raw-octs HTTP reply with an arbitrary content-type (schooner has no generic
::  binary-with-custom-type variant; go straight to server's give-simple-payload).
++  git-reply
  |=  [eyre-id=@ta ctype=@t body=octs]
  ^-  (list card)
  %+  give-simple-payload:app:server  eyre-id
  :-  [200 ~[['content-type' ctype] ['cache-control' 'no-cache']]]
  `[p.body q.body]
::
::  === git smart-HTTP builders ======================================
::  info/refs advertisement for git-upload-pack.
++  info-refs-upload
  |=  r=repo
  ^-  octs
  =/  svc  (pkt:git (cat:git (cord-octs:git '# service=git-upload-pack') (byt:git 10)))
  =/  ref-list  ~(tap by refs.r)
  ?~  ref-list
    =/  zero  (crip (reap 64 '0'))
    =/  caps  'capabilities^{}'
    =/  cap-line
      %-  pkt:git
      %-  cats:git
      :~  (cord-octs:git zero)  (byt:git ' ')  (cord-octs:git caps)  (byt:git 0)
          (cord-octs:git 'object-format=sha256 agent=drive-code')  (byt:git 10)
      ==
    (cats:git ~[svc flush:git cap-line flush:git])
  =/  head-sha  (~(gut by refs.r) head.r `hash`0x0)
  =/  caps=@t
    (crip "object-format=sha256 symref=HEAD:{(trip head.r)} agent=drive-code")
  =/  head-line
    %-  pkt:git
    %-  cats:git
    :~  (cord-octs:git (render-hash:git head-sha))  (byt:git ' ')
        (cord-octs:git 'HEAD')  (byt:git 0)  (cord-octs:git caps)  (byt:git 10)
    ==
  =/  ref-lines
    %-  cats:git
    %+  turn  ref-list
    |=  [name=@t sha=hash]
    %-  pkt:git
    %-  cats:git
    :~  (cord-octs:git (render-hash:git sha))  (byt:git ' ')
        (cord-octs:git name)  (byt:git 10)
    ==
  (cats:git ~[svc flush:git head-line ref-lines flush:git])
::  git-upload-pack response: NAK + a packfile of every object reachable from
::  the wanted refs. We ignore the specific `want`/`have` negotiation and send
::  the full object set (correct for a fresh clone).
++  upload-pack
  |=  r=repo
  ^-  octs
  =/  tips=(list hash)  ~(val by refs.r)
  =/  want=(set hash)
    %+  roll  tips
    |=  [tip=hash acc=(set hash)]
    (~(gas in acc) (reachable:git tip objects.r))
  =/  objs=(list [hash gobject])
    %+  turn  ~(tap in want)
    |=  h=hash
    [h (~(got by objects.r) h)]
  =/  nak  (cord-octs:git '0008NAK\0a')
  (cat:git nak (make-pack:git objs))
::  self-test: git-identical sha256 object ids (empty blob 473a0f4c…, etc.)
++  selftest-body
  ^-  tape
  =/  hello  (cat:git (cord-octs:git 'hello') (byt:git 10))
  ;:  weld
    "empty-blob "  (trip (render-hash:git (hash-object:git [%blob emp:git])))  "\0a"
    "empty-tree "  (trip (render-hash:git -:(build-tree:git ~)))  "\0a"
    "blob-hello "  (trip (render-hash:git (hash-object:git [%blob hello])))  "\0a"
  ==
--
