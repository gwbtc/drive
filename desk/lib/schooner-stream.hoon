::  /lib/schooner-stream.hoon
::    Server-Sent Events streaming over Eyre's /http-response/<id>
::    subscription protocol. Companion to schooner.hoon for live channels
::    that don't fit the request/response model.
::
::  Usage from a gall agent:
::    Receive %handle-http-request poke for an SSE endpoint:
::      cards = (begin:schooner-stream eyre-id)
::      ::  store eyre-id somewhere; track it as an active stream
::    Later, when there's data to push:
::      cards = (send:schooner-stream eyre-id 'update' '{"...":...}')
::    Heartbeat (every ~25s to keep middleboxes from closing):
::      cards = (ping:schooner-stream eyre-id)
::    On close (revocation, server shutdown, client gone):
::      cards = (end:schooner-stream eyre-id)
::
=,  eyre
|%
::
::  begin: emit headers and an initial flush comment, leaving the
::         /http-response/<eyre-id> subscription open.
::
++  begin
  |=  eyre-id=@ta
  ^-  (list card:agent:gall)
  =/  header  ^-  response-header:http
    :-  200
    :~  'content-type'^'text/event-stream'
        'cache-control'^'no-cache'
        'connection'^'keep-alive'
        'x-accel-buffering'^'no'
    ==
  =/  greeting=@t  ': open\0a\0a'
  =/  greeting-octs=octs  [(met 3 greeting) greeting]
  :~  [%give %fact ~[/http-response/[eyre-id]] %http-response-header !>(header)]
      [%give %fact ~[/http-response/[eyre-id]] %http-response-data !>(`greeting-octs)]
  ==
::
::  send: emit one SSE event with the given type and data payload.
::         Data must be a single line (no embedded newlines).
::
++  send
  |=  [eyre-id=@ta type=@t data=@t]
  ^-  (list card:agent:gall)
  =/  body=@t
    %-  crip
    ;:  weld
      "event: "  (trip type)  "\0a"
      "data: "   (trip data)  "\0a\0a"
    ==
  =/  payload=octs  [(met 3 body) body]
  :~  [%give %fact ~[/http-response/[eyre-id]] %http-response-data !>(`payload)]
  ==
::
::  ping: emit an SSE comment for keepalive
::
++  ping
  |=  eyre-id=@ta
  ^-  (list card:agent:gall)
  =/  body=@t  ': keepalive\0a\0a'
  =/  payload=octs  [(met 3 body) body]
  :~  [%give %fact ~[/http-response/[eyre-id]] %http-response-data !>(`payload)]
  ==
::
::  end: signal end-of-body and close the subscription
::
++  end
  |=  eyre-id=@ta
  ^-  (list card:agent:gall)
  :~  [%give %fact ~[/http-response/[eyre-id]] %http-response-data !>(`(unit octs)`~)]
      [%give %kick ~[/http-response/[eyre-id]] ~]
  ==
--
