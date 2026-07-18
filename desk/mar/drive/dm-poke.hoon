::  /mar/drive/dm-poke.hoon
::    A 1:1 direct message, ship → ship. Noun-only (no json grab): the
::    receiver stamps author=src, so it can't be spoofed via a channel poke.
::
/-  *drive
|_  d=dm-poke
++  grow
  |%
  ++  noun  d
  --
++  grab
  |%
  ++  noun  dm-poke
  --
++  grad  %noun
--
