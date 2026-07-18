::  /mar/drive/space-invite-notice.hoon
::    Host → recipient: "you're invited to this space" (populates the
::    recipient's space-invites inbox). Noun-only.
::
/-  *drive
|_  n=space-invite-notice
++  grow
  |%
  ++  noun  n
  --
++  grab
  |%
  ++  noun  space-invite-notice
  --
++  grad  %noun
--
