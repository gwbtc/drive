::  /mar/documents/share-notice.hoon
::    Owner → recipient: "I shared this doc with you" (populates the
::    recipient's invites index / Shared-with-me listing). Noun-only.
::
/-  *documents
|_  n=share-notice
++  grow
  |%
  ++  noun  n
  --
++  grab
  |%
  ++  noun  share-notice
  --
++  grad  %noun
--
