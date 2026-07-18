::  /app/code.hoon
::    %code — git hosting + code collaboration in Drive. Serves git smart-HTTP
::    under /code so a stock `git` client can clone/fetch, and stores real git
::    objects (/lib/git.hoon). Git hashing runs here in poke/HTTP-handler
::    context (jetted crypto is unavailable in a gall scry).
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
::  eyre subscribes on /http-response/<eyre-id> to receive our schooner reply;
::  accept it (default-agent would crash on the unknown path → HTTP 500).
++  on-watch
  |=  =path
  ^-  (quip card _this)
  ?+  path  (on-watch:def path)
    [%http-response *]  `this
  ==
++  on-leave  |=(path `this)
++  on-agent  on-agent:def
::  eyre acks our /code %connect on wire /eyre/connect; ignore all arvo signs
::  (default-agent crashes on the "unexpected" eyre response).
++  on-arvo   |=([wire sign-arvo] `this)
++  on-fail   on-fail:def
--
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
  (pairs ~[name+s+name.r description+s+description.r public+b+public.r])
::
::  === HTTP: git smart-HTTP + a self-test ===========================
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
  ::  liveness probe (no crypto).
  ?:  ?=([%ping ~] rest)
    [(send [200 ~ [%plain "pong"]]) state]
  ::  prove git-identical hashing IN POKE CONTEXT (crypto jets are available
  ::  here, unlike in a scry): empty blob e69de29b… · empty tree 4b825dc6…
  ?:  ?=([%git-selftest ~] rest)
    =/  hello=octs  (cat:git (cord-octs:git 'hello') (byt:git 10))
    =/  body=tape
      ;:  weld
        "empty-blob "  (trip (render-hash:git (hash-object:git [%blob emp:git])))  "\0a"
        "empty-tree "  (trip (render-hash:git -:(build-tree:git ~)))  "\0a"
        "blob-hello "  (trip (render-hash:git (hash-object:git [%blob hello])))  "\0a"
      ==
    [(send [200 ~ [%plain body]]) state]
  [(send [404 ~ [%plain "not found"]]) state]
--
