::  /mar/drive/set-nickname-poke.hoon
::    A member ship → the space host: "here is my nickname".
::    Noun-only (no json grab) so it can't be poked from a browser channel.
::
/-  *drive
|_  p=set-nickname-poke
++  grow
  |%
  ++  noun  p
  --
++  grab
  |%
  ++  noun  set-nickname-poke
  --
++  grad  %noun
--
