::  /mar/drive/space-upload-poke.hoon
::    A member ship → the space host: store this file in your space for me.
::    Noun-only (no json grab) so it can't be poked from a browser channel.
::
/-  *drive
|_  p=space-upload-poke
++  grow
  |%
  ++  noun  p
  --
++  grab
  |%
  ++  noun  space-upload-poke
  --
++  grad  %noun
--
