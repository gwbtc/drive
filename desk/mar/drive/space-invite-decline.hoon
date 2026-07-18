::  /mar/drive/space-invite-decline.hoon
::    Recipient → host: "I declined your space invite" (host drops them from
::    the roster). Noun-only.
::
/-  *drive
|_  d=space-invite-decline
++  grow
  |%
  ++  noun  d
  --
++  grab
  |%
  ++  noun  space-invite-decline
  --
++  grad  %noun
--
