::  /mar/drive/comment-poke.hoon
::    Inter-ship comment mutation: an editing/commenting ship → the owner.
::    Deliberately noun-only (no json grab) so browser channel pokes
::    can't reach it directly.
::
/-  *drive
|_  c=comment-poke
++  grow
  |%
  ++  noun  c
  --
++  grab
  |%
  ++  noun  comment-poke
  --
++  grad  %noun
--
