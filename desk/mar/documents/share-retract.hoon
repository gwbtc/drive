::  /mar/documents/share-retract.hoon
::    Owner → recipient: "that share is gone" (removes the invite). Noun-only.
::
/-  *documents
|_  r=share-retract
++  grow
  |%
  ++  noun  r
  --
++  grab
  |%
  ++  noun  share-retract
  --
++  grad  %noun
--
