::  /mar/drive/action.hoon
::    Noun-only mark for action values. Client-side actions are POSTed as
::    JSON via /apps/drive/action and parsed inside the agent (see
::    +dejs-action in app/drive.hoon), not via Eyre channel pokes.
::
/-  *drive
|_  act=action
++  grow
  |%
  ++  noun  act
  --
++  grab
  |%
  ++  noun  action
  --
++  grad  %noun
--
::
::  Note: this mark intentionally lacks a json grab arm. Trying to cast
::  %json -> %drive-action via a channel poke will fail; that's by
::  design — pokes go through HTTP POST /apps/drive/action.
::
