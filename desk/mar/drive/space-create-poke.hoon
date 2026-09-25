::  /mar/drive/space-create-poke.hoon
::    A member ship → the space host: make a doc in your space for me.
::    Noun-only (no json grab) so it can't be poked from a browser channel.
::
/-  *drive
|_  p=space-create-poke
++  grow
  |%
  ++  noun  p
  --
++  grab
  |%
  ++  noun  space-create-poke
  --
++  grad  %noun
--
