::  /mar/documents/comment-poke.hoon
::    Inter-ship comment mutation: an editing/commenting ship → the owner.
::    Deliberately noun-only (no json grab) so browser channel pokes
::    can't reach it directly.
::
/-  *documents
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
