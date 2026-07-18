::  /sur/drive.hoon
::    Types for the Drive app (codename %drive).
::
|%
+$  doc-id     @uv
+$  comment-id  @uv
+$  doc-type  ?(%text %sheet %note %image %file %folder)
+$  file-blob  [mime=@t bytes=@ux size=@ud]
+$  role      ?(%viewer %commenter %editor %owner)
::
::  a shared space (team drive): a named container hosted on one ship whose
::  member roster grants access to ALL docs in the space at once. %admin can
::  manage members + content; %owner also may delete the space.
+$  space-id    @uv
+$  space-role  ?(%viewer %commenter %editor %admin %owner)
+$  space
  $:  name=@t
      host=@p                                ::  the ship hosting the space
      members=(map @p space-role)
      created=@da
  ==
::  a doc as advertised over a space channel (the list, not the content)
+$  space-doc  [title=@t =doc-type modified=@da]
::  subscriber side: a space we've joined that's hosted on another ship
+$  space-mirror
  $:  host=@p
      name=@t
      =space-role                            ::  our role in the space
      docs=(map doc-id space-doc)            ::  docs the host says are in it
      members=(map @p space-role)            ::  roster, propagated by the host
  ==
::  a pending invitation to join a space hosted on another ship
+$  space-invite
  $:  host=@p
      =space-id
      name=@t
      =space-role                            ::  the role we're offered
      at=@da
  ==
::  host → recipient space-invite lifecycle pokes
+$  space-invite-notice   [=space-id name=@t =space-role]
+$  space-invite-decline  [=space-id]
::
::  ===  chat: per-space rooms + 1:1 direct messages  ===================
::  A single message. `at` is the send time; the space host (for room
::  messages) or the sender (for DMs) mints the id + stamps the time.
+$  msg-id  @uv
+$  chat-msg
  $:  =msg-id
      author=@p
      text=@t
      at=@da
  ==
::  a 1:1 DM conversation with one counterparty. `msgs` newest-first, capped;
::  `read` is the timestamp through which we've marked the thread read (drives
::  the unread badge).
+$  dm-thread
  $:  msgs=(list chat-msg)
      read=@da
  ==
::  member → host: post to / delete from a space's room. The host is the
::  single writer + ordering authority, mirroring the /doc owner model.
+$  space-chat-poke
  $:  =space-id
      $=  act
      $%  [%post text=@t]
          [%delete =msg-id]
      ==
  ==
::  ship → ship DM delivery. The receiver stamps author=src (unspoofable);
::  the sender supplies the id + its own send time.
+$  dm-poke  [=msg-id text=@t at=@da]
::
+$  comment
  $:  author=@p
      text=@t
      anchor=@t                              ::  snippet of commented text
      created=@da
      resolved=_|
  ==
::
::  a buffered Yjs update, stamped with when/who for version history
+$  stamped-update  [at=@da author=@p data=octs]
::
::  a version checkpoint: full doc state at a moment. Auto-created at
::  every compaction; named ones via %save-version. Unnamed checkpoints
::  are capped (oldest dropped); named ones are kept.
+$  version
  $:  at=@da
      author=@p                              ::  who triggered the checkpoint
      contributors=(set @p)                  ::  authors of compacted updates
      label=(unit @t)                        ::  user-assigned name
      blob=octs                              ::  full encoded Y.Doc state
  ==
::
+$  document
  $:  =doc-type
      title=@t
      created=@da
      modified=@da
      parent=(unit doc-id)                   ::  containing folder; ~ for root
      acl=(map @p role)
      updates=(list stamped-update)          ::  opaque Yjs updates, newest-first
      snapshot=[seq=@ud blob=octs]
      versions=(list version)                ::  newest-first checkpoints
      comments=(map @uv comment)             ::  doc-level comments
      trashed=(unit @da)                     ::  soft-delete timestamp; ~ if live
  ==
::
::  an editor→owner update we poked upstream but haven't seen acked
+$  pending-update  [seq=@ud tries=@ud u=octs]
::
+$  mirror
  $:  owner=@p
      =doc-type
      title=@t
      =role
      cached=[seq=@ud blob=octs]             ::  latest upstream snapshot
      tail=(list octs)                       ::  updates since cached
      next-seq=@ud                           ::  outbox sequence counter
      pending=(list pending-update)          ::  un-acked forwarded edits
      comments=(map @uv comment)             ::  mirrored from the owner
  ==
::
::  a share we were told about by an owner (populates "Shared with me"
::  before we've ever opened the doc / established a mirror)
+$  invite
  $:  owner=@p
      title=@t
      =doc-type
      =role
      at=@da
  ==
::
+$  token-grant
  $:  =doc-id
      =role
      created=@da
      revoked=_|
  ==
::
+$  token-session
  $:  =doc-id
      =role
      expires=@da
      from-token=@uv                         ::  minting grant; 0v0 = legacy sentinel
  ==
::
+$  sse-sub
  $:  =doc-id
      session=@uv
  ==
::
::  marks crossing the wire
::
+$  update-poke     [=doc-id update=octs]
+$  awareness-poke  [=doc-id ship=@p blob=octs]
::
::  facts given on /doc/<id> subscriptions
::
+$  fact
  $%  [%snapshot seq=@ud blob=octs]
      [%update update=octs]
      [%awareness ship=@p blob=octs]
      [%role-change who=@p =role]           ::  who: facts fan path-wide;
                                            ::  consumers filter on self
      [%revoked ~]
      [%request-snapshot ~]                  ::  asks a connected client to encode
      [%meta title=@t modified=@da =doc-type]
      [%trashed at=@da]
      [%blob mime=@t data=octs]              ::  file/image bytes for mirrors
      [%comment-add =comment-id =comment]
      [%comment-resolved =comment-id]
      [%comment-deleted =comment-id]
      [%save-failed ~]                       ::  a forwarded edit was rejected
      ::  space channel (/space/<id>): membership + doc-list distribution
      [%space-meta name=@t =space-role]      ::  your role + the space name
      [%space-doc =doc-id =space-doc]        ::  a doc joined/updated in the space
      [%space-doc-gone =doc-id]              ::  a doc left the space
      [%space-roster members=(map @p space-role)]  ::  the full member roster
      [%space-kicked ~]                      ::  you were removed / space deleted
      ::  per-space chatroom, fanned over /space/<id> to every member ship
      [%space-chat-log msgs=(list chat-msg)]  ::  recent history burst (on watch)
      [%space-chat-msg =chat-msg]             ::  a new message posted to the room
      [%space-chat-del =msg-id]               ::  a message was deleted
  ==
::
::  editor-ship → owner-ship comment mutations (mirrors can't edit
::  comments locally; they forward and the owner fans back)
+$  comment-poke
  $:  =doc-id
      =comment-id
      $=  act
      $%  [%add text=@t anchor=@t]
          [%resolve ~]
          [%delete ~]
      ==
  ==
::
::  owner → recipient share lifecycle (populates/retracts invites)
+$  share-notice   [=doc-id title=@t =doc-type =role]
+$  share-retract  [=doc-id]
::
::  actions issued by the local browser (HTTP POST /drive/action)
::
+$  action
  $%  [%create =doc-type title=@t parent=(unit doc-id)]
      [%create-folder title=@t parent=(unit doc-id)]
      [%rename =doc-id title=@t]
      [%delete =doc-id]
      [%move =doc-id new-parent=(unit doc-id)]
      [%share =doc-id who=@p =role]
      [%revoke =doc-id who=@p]
      [%mint-token =doc-id =role]
      [%revoke-token token=@uv]
      [%subscribe-remote owner=@p =doc-id]
      [%unsubscribe-remote =doc-id]
      [%submit-update =doc-id update=octs]
      [%submit-awareness =doc-id blob=octs]
      ::  gen: snapshot generation the client encoded against (stale ones
      ::  are dropped); covered: how many updates the encode included, so
      ::  the server truncates exactly those and updates that raced in
      ::  during the encode survive.
      [%submit-snapshot =doc-id gen=@ud covered=@ud blob=octs]
      [%add-comment =doc-id =comment-id text=@t anchor=@t]
      [%resolve-comment =doc-id comment-id=@uv]
      [%delete-comment =doc-id comment-id=@uv]
      [%restore =doc-id]
      [%purge =doc-id]
      [%star =doc-id on=?]
      ::  duplicate a doc's content (not its comments/acl/history) into a
      ::  new owned doc titled "Copy of …"
      [%copy =doc-id]
      ::  store a named checkpoint of client-encoded full state (also used
      ::  as the "Before restore" safeguard)
      [%save-version =doc-id label=@t blob=octs]
      [%bulk-delete docs=(list doc-id)]
      [%bulk-restore docs=(list doc-id)]
      [%bulk-purge docs=(list doc-id)]
      [%bulk-move docs=(list doc-id) new-parent=(unit doc-id)]
      ::  shared spaces (company collaboration)
      [%create-space name=@t]
      [%rename-space =space-id name=@t]
      [%delete-space =space-id]
      [%add-member =space-id who=@p =space-role]
      [%remove-member =space-id who=@p]
      [%set-member-role =space-id who=@p =space-role]
      ::  assign a doc to a space (space=~ makes it personal again)
      [%set-doc-space =doc-id space=(unit space-id)]
      ::  cross-ship: join / leave a space hosted on another ship
      [%join-space host=@p =space-id]
      [%leave-space =space-id]
      ::  space invitations (host invites a ship; recipient accepts/declines)
      [%invite-to-space =space-id who=@p =space-role]
      [%accept-space-invite =space-id]
      [%decline-space-invite =space-id]
      ::  chat: post/delete in a space room; send/read/delete a 1:1 DM
      [%post-message space=space-id text=@t]
      [%delete-message space=space-id =msg-id]
      [%read-space space=space-id]
      [%send-dm who=@p text=@t]
      [%delete-dm who=@p =msg-id]
      [%read-dm who=@p]
  ==
--
