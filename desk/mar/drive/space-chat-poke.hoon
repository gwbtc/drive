::  /mar/drive/space-chat-poke.hoon
::    A member ship → the space host: post to / delete from the room.
::    Noun-only (no json grab) so it can't be poked from a browser channel.
::
/-  *drive
|_  p=space-chat-poke
++  grow
  |%
  ++  noun  p
  --
++  grab
  |%
  ++  noun  space-chat-poke
  --
++  grad  %noun
--
