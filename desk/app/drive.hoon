::  /app/drive.hoon
::    Drive — collaborative editor on Urbit (codename %drive).
::
::    Files live on the owner ship. Other ships subscribe and forward
::    Yjs binary updates back to the owner; the owner appends and fans
::    out to all subscribers. Per-ship ACL plus link-token sharing.
::
/-  *drive
/+  default-agent, dbug, server, schooner, schooner-stream
/*  drive-ui   %html  /app/drive/ui/html
/*  drive-js   %js    /app/drive/js/js
/*  drive-css  %css   /app/drive/css/css
/*  drive-sw   %js    /app/drive/sw/js
::
|%
+$  card  card:agent:gall
+$  versioned-state
  $%  state-13
      state-12
      state-11
      state-10
      state-9
      state-8
      state-7
      state-6-pre-trash
      state-5-pre-anchor
      state-4-pre-comments
      state-3-pre-pending
      state-2-pre-octs
      state-1-pre-folders
      state-0-pre-image
  ==
+$  state-13
  $:  %13
      docs=(map doc-id document)
      mirrors=(map doc-id mirror)
      tokens=(map @uv token-grant)
      sessions=(map @uv token-session)
      sse-clients=(map @ta sse-sub)
      blobs=(map doc-id file-blob)
      children=(map doc-id (set doc-id))
      pending-sse=(list pending-sse-event)
      invites=(map doc-id invite)
      starred=(set doc-id)
      thumbs=(map doc-id octs)
      spaces=(map space-id space)
      doc-space=(map doc-id space-id)
      space-mirrors=(map space-id space-mirror)
      space-invites=(map space-id space-invite)
      space-chat=(map space-id (list chat-msg))
      space-read=(map space-id @da)
      dms=(map @p dm-thread)
      my-nickname=@t                         ::  this ship's own nickname ('' = none)
      nicknames=(map @p @t)                  ::  peer @p → nickname, learned from hosts
  ==
+$  state-12
  $:  %12
      docs=(map doc-id document)
      mirrors=(map doc-id mirror)
      tokens=(map @uv token-grant)
      sessions=(map @uv token-session)
      sse-clients=(map @ta sse-sub)
      blobs=(map doc-id file-blob)
      children=(map doc-id (set doc-id))     ::  parent-id → children; 0v0=root
      pending-sse=(list pending-sse-event)   ::  queued for next behn tick
      invites=(map doc-id invite)            ::  shares pushed to us by owners
      starred=(set doc-id)                   ::  any doc-id: owned or mirrored
      thumbs=(map doc-id octs)               ::  client-generated image thumbnails
      spaces=(map space-id space)            ::  shared spaces we host
      doc-space=(map doc-id space-id)        ::  which space a doc belongs to
      space-mirrors=(map space-id space-mirror)  ::  spaces we joined elsewhere
      space-invites=(map space-id space-invite)  ::  pending invites pushed to us
      ::  chat (v12): per-space rooms + 1:1 DMs. For a space we host, its log
      ::  is authoritative; for one we joined, the host mirrors it here (same
      ::  map, keyed by space-id). Logs are newest-first and capped.
      space-chat=(map space-id (list chat-msg))
      space-read=(map space-id @da)          ::  last-read stamp per space
      dms=(map @p dm-thread)                 ::  1:1 conversations by counterparty
  ==
+$  state-11
  $:  %11
      docs=(map doc-id document)
      mirrors=(map doc-id mirror)
      tokens=(map @uv token-grant)
      sessions=(map @uv token-session)
      sse-clients=(map @ta sse-sub)
      blobs=(map doc-id file-blob)
      children=(map doc-id (set doc-id))     ::  parent-id → children; 0v0=root
      pending-sse=(list pending-sse-event)   ::  queued for next behn tick
      invites=(map doc-id invite)            ::  shares pushed to us by owners
      starred=(set doc-id)                   ::  any doc-id: owned or mirrored
      thumbs=(map doc-id octs)               ::  client-generated image thumbnails
      spaces=(map space-id space)            ::  shared spaces we host
      doc-space=(map doc-id space-id)        ::  which space a doc belongs to
      space-mirrors=(map space-id space-mirror)  ::  spaces we joined elsewhere
      space-invites=(map space-id space-invite)  ::  pending invites pushed to us
  ==
+$  state-10
  $:  %10
      docs=(map doc-id document)
      mirrors=(map doc-id mirror)
      tokens=(map @uv token-grant)
      sessions=(map @uv token-session)
      sse-clients=(map @ta sse-sub)
      blobs=(map doc-id file-blob)
      children=(map doc-id (set doc-id))     ::  parent-id → children; 0v0=root
      pending-sse=(list pending-sse-event)   ::  queued for next behn tick
      invites=(map doc-id invite)            ::  shares pushed to us by owners
      starred=(set doc-id)                   ::  any doc-id: owned or mirrored
      thumbs=(map doc-id octs)               ::  client-generated image thumbnails
  ==
+$  state-9
  $:  %9
      docs=(map doc-id document)
      mirrors=(map doc-id mirror)
      tokens=(map @uv token-grant)
      sessions=(map @uv token-session)
      sse-clients=(map @ta sse-sub)
      blobs=(map doc-id file-blob)
      children=(map doc-id (set doc-id))     ::  parent-id → children; 0v0=root
      pending-sse=(list pending-sse-event)   ::  queued for next behn tick
      invites=(map doc-id invite)            ::  shares pushed to us by owners
      starred=(set doc-id)                   ::  any doc-id: owned or mirrored
  ==
::  v8 document, frozen: updates were bare octs (no author/time stamps),
::  no version checkpoints.
+$  state-8-document
  $:  =doc-type
      title=@t
      created=@da
      modified=@da
      parent=(unit doc-id)
      acl=(map @p role)
      updates=(list octs)
      snapshot=[seq=@ud blob=octs]
      comments=(map @uv comment)
      trashed=(unit @da)
  ==
+$  state-8
  $:  %8
      docs=(map doc-id state-8-document)
      mirrors=(map doc-id mirror)
      tokens=(map @uv token-grant)
      sessions=(map @uv token-session)
      sse-clients=(map @ta sse-sub)
      blobs=(map doc-id file-blob)
      children=(map doc-id (set doc-id))     ::  parent-id → children; 0v0=root
      pending-sse=(list pending-sse-event)   ::  queued for next behn tick
      invites=(map doc-id invite)            ::  shares pushed to us by owners
  ==
::  v7 shapes, frozen: document still carried the never-read `subscribers`
::  set, mirrors had no outbox/comments, sessions had no token back-link.
+$  state-7-document
  $:  =doc-type
      title=@t
      created=@da
      modified=@da
      parent=(unit doc-id)
      acl=(map @p role)
      updates=(list octs)
      snapshot=[seq=@ud blob=octs]
      subscribers=(set @p)
      comments=(map @uv comment)
      trashed=(unit @da)
  ==
+$  state-7-mirror
  $:  owner=@p
      =doc-type
      title=@t
      =role
      cached=[seq=@ud blob=octs]
      tail=(list octs)
  ==
+$  state-7-session
  $:  =doc-id
      =role
      expires=@da
  ==
+$  state-7
  $:  %7
      docs=(map doc-id state-7-document)
      mirrors=(map doc-id state-7-mirror)
      tokens=(map @uv token-grant)
      sessions=(map @uv state-7-session)
      sse-clients=(map @ta sse-sub)
      blobs=(map doc-id file-blob)
      children=(map doc-id (set doc-id))     ::  parent-id → children; 0v0=root
      pending-sse=(list pending-sse-event)   ::  queued for next behn tick
  ==
+$  state-6-pre-trash
  $:  %6
      docs-pre-trash=(map doc-id state-6-document)
      mirrors=(map doc-id state-7-mirror)
      tokens=(map @uv token-grant)
      sessions=(map @uv state-7-session)
      sse-clients=(map @ta sse-sub)
      blobs=(map doc-id file-blob)
      children=(map doc-id (set doc-id))
      pending-sse=(list pending-sse-event)
  ==
+$  state-6-document
  $:  =doc-type
      title=@t
      created=@da
      modified=@da
      parent=(unit doc-id)
      acl=(map @p role)
      updates=(list octs)
      snapshot=[seq=@ud blob=octs]
      subscribers=(set @p)
      comments=(map @uv comment)
  ==
+$  state-5-pre-anchor
  $:  %5
      docs-pre-anchor=(map doc-id state-5-document)
      mirrors=(map doc-id state-7-mirror)
      tokens=(map @uv token-grant)
      sessions=(map @uv state-7-session)
      sse-clients=(map @ta sse-sub)
      blobs=(map doc-id file-blob)
      children=(map doc-id (set doc-id))
      pending-sse=(list pending-sse-event)
  ==
+$  state-5-comment  [author=@p text=@t created=@da resolved=_|]
+$  state-5-document
  $:  =doc-type
      title=@t
      created=@da
      modified=@da
      parent=(unit doc-id)
      acl=(map @p role)
      updates=(list octs)
      snapshot=[seq=@ud blob=octs]
      subscribers=(set @p)
      comments=(map @uv state-5-comment)
  ==
+$  pending-sse-event  [eid=@ta data=@t]
+$  state-4-pre-comments
  $:  %4
      docs-pre-comments=(map doc-id state-4-document)
      mirrors=(map doc-id state-7-mirror)
      tokens=(map @uv token-grant)
      sessions=(map @uv state-7-session)
      sse-clients=(map @ta sse-sub)
      blobs=(map doc-id file-blob)
      children=(map doc-id (set doc-id))
      pending-sse=(list pending-sse-event)
  ==
+$  state-4-document
  $:  =doc-type
      title=@t
      created=@da
      modified=@da
      parent=(unit doc-id)
      acl=(map @p role)
      updates=(list octs)
      snapshot=[seq=@ud blob=octs]
      subscribers=(set @p)
  ==
+$  state-3-pre-pending
  $:  %3
      docs=(map doc-id state-4-document)
      mirrors=(map doc-id state-7-mirror)
      tokens=(map @uv token-grant)
      sessions=(map @uv state-7-session)
      sse-clients=(map @ta sse-sub)
      blobs=(map doc-id file-blob)
      children=(map doc-id (set doc-id))
  ==
+$  state-2-pre-octs
  $:  %2
      docs-pre-octs=(map doc-id state-2-document)
      mirrors-pre-octs=(map doc-id state-2-mirror)
      tokens=(map @uv token-grant)
      sessions=(map @uv state-7-session)
      sse-clients=(map @ta sse-sub)
      blobs=(map doc-id file-blob)
      children=(map doc-id (set doc-id))
  ==
+$  state-2-document
  $:  =doc-type
      title=@t
      created=@da
      modified=@da
      parent=(unit doc-id)
      acl=(map @p role)
      updates=(list @ux)
      snapshot=[seq=@ud blob=@ux]
      subscribers=(set @p)
  ==
+$  state-2-mirror
  $:  owner=@p
      =doc-type
      title=@t
      =role
      cached=[seq=@ud blob=@ux]
      tail=(list @ux)
  ==
+$  state-1-pre-folders
  $:  %1
      docs-old=(map doc-id state-1-document)
      mirrors-old=(map doc-id state-1-mirror)
      tokens=(map @uv token-grant)
      sessions=(map @uv state-7-session)
      sse-clients=(map @ta sse-sub)
      images=(map doc-id state-1-image-blob)
  ==
+$  state-1-document
  $:  doc-type=?(%text %sheet %note %image)
      title=@t
      created=@da
      modified=@da
      acl=(map @p role)
      updates=(list @ux)
      snapshot=[seq=@ud blob=@ux]
      subscribers=(set @p)
  ==
+$  state-1-mirror
  $:  owner=@p
      doc-type=?(%text %sheet %note %image)
      title=@t
      =role
      cached=[seq=@ud blob=@ux]
      tail=(list @ux)
  ==
+$  state-1-image-blob  [mime=@t bytes=@ux size=@ud]
+$  state-0-pre-image
  $:  %0
      docs-v0=(map doc-id state-1-document)
      mirrors-v0=(map doc-id state-1-mirror)
      tokens=(map @uv token-grant)
      sessions=(map @uv state-7-session)
      sse-clients=(map @ta sse-sub)
  ==
--
::
%-  agent:dbug
=|  state-13
=*  state  -
^-  agent:gall
::
=<
|_  =bowl:gall
+*  this  .
    def  ~(. (default-agent this %.n) bowl)
    cor  ~(. +> [bowl state])
::
++  on-init
  ^-  (quip card _this)
  =^  cards  state  init:cor
  [cards this]
::
++  on-save  !>(state)
::
++  on-load
  |=  old=vase
  ^-  (quip card _this)
  ::  Re-bind eyre to /drive (in case we were previously bound to /apps/drive,
  ::  or to ensure fresh installs are also bound). %disconnect is idempotent.
  =/  rebind=(list card)
    :~  [%pass /eyre/disconnect %arvo %e %disconnect [~ /apps/drive]]
        [%pass /eyre/connect %arvo %e %connect [~ /drive] %drive]
        ::  Ensure the session-sweep alarm is running on existing piers.
        ::  Multiple parallel sweepers across many |commits are harmless;
        ::  each just walks the (small) sessions map.
        [%pass /session-sweep %arvo %b %wait (add now.bowl ~m5)]
        [%pass /trash-sweep %arvo %b %wait (add now.bowl ~h1)]
    ==
  =/  rebuild-children
    |=  ds=(map doc-id state-7-document)
    ^-  (map doc-id (set doc-id))
    =/  acc=(map doc-id (set doc-id))  ~
    %+  roll  ~(tap by ds)
    |=  [[did=doc-id d=state-7-document] a=_acc]
    =/  pkey=doc-id  ?~(parent.d 0v0 u.parent.d)
    =/  cur=(set doc-id)  (~(gut by a) pkey ~)
    (~(put by a) pkey (~(put in cur) did))
  ::  Wrap an @ux as octs using its measured length. Lossy for legacy
  ::  data with trailing-zero bytes (this was the v0.3 bug); new updates
  ::  preserve length correctly.
  =/  ux-to-octs
    |=  a=@ux
    ^-  octs
    [(met 3 a) a]
  =/  upgrade-doc-2-to-3
    |=  d=state-2-document
    ^-  state-7-document
    :*  doc-type=doc-type.d
        title=title.d
        created=created.d
        modified=modified.d
        parent=parent.d
        acl=acl.d
        updates=(turn updates.d ux-to-octs)
        snapshot=[seq.snapshot.d (ux-to-octs blob.snapshot.d)]
        subscribers=subscribers.d
        comments=*(map @uv comment)
        trashed=~
    ==
  =/  upgrade-mirror-2-to-3
    |=  m=state-2-mirror
    ^-  state-7-mirror
    :*  owner=owner.m
        doc-type=doc-type.m
        title=title.m
        role=role.m
        cached=[seq.cached.m (ux-to-octs blob.cached.m)]
        tail=(turn tail.m ux-to-octs)
    ==
  =/  upgrade-doc-1-to-3
    |=  d=state-1-document
    ^-  state-7-document
    :*  doc-type=doc-type.d
        title=title.d
        created=created.d
        modified=modified.d
        parent=~
        acl=acl.d
        updates=(turn updates.d ux-to-octs)
        snapshot=[seq.snapshot.d (ux-to-octs blob.snapshot.d)]
        subscribers=subscribers.d
        comments=*(map @uv comment)
        trashed=~
    ==
  =/  upgrade-mirror-1-to-3
    |=  m=state-1-mirror
    ^-  state-7-mirror
    :*  owner=owner.m
        doc-type=doc-type.m
        title=title.m
        role=role.m
        cached=[seq.cached.m (ux-to-octs blob.cached.m)]
        tail=(turn tail.m ux-to-octs)
    ==
  =/  upgrade-blob-1-to-3
    |=  b=state-1-image-blob
    ^-  file-blob
    [mime=mime.b bytes=bytes.b size=size.b]
  ::
  =/  upgrade-doc-4-to-5
    |=  d=state-4-document
    ^-  state-7-document
    :*  doc-type=doc-type.d
        title=title.d
        created=created.d
        modified=modified.d
        parent=parent.d
        acl=acl.d
        updates=updates.d
        snapshot=snapshot.d
        subscribers=subscribers.d
        comments=*(map @uv comment)
        trashed=~
    ==
  =/  upgrade-comment-5-to-6
    |=  c=state-5-comment
    ^-  comment
    [author=author.c text=text.c anchor='' created=created.c resolved=resolved.c]
  =/  upgrade-doc-5-to-6
    |=  d=state-5-document
    ^-  state-7-document
    :*  doc-type=doc-type.d
        title=title.d
        created=created.d
        modified=modified.d
        parent=parent.d
        acl=acl.d
        updates=updates.d
        snapshot=snapshot.d
        subscribers=subscribers.d
        comments=(~(run by comments.d) upgrade-comment-5-to-6)
        trashed=~
    ==
  =/  upgrade-doc-6-to-7
    |=  d=state-6-document
    ^-  state-7-document
    :*  doc-type=doc-type.d
        title=title.d
        created=created.d
        modified=modified.d
        parent=parent.d
        acl=acl.d
        updates=updates.d
        snapshot=snapshot.d
        subscribers=subscribers.d
        comments=comments.d
        trashed=~
    ==
  ::  v7 → v8: drop the never-read subscribers set (sup.bowl is the
  ::  truth), give mirrors an empty outbox + comments, stamp sessions
  ::  with the 0v0 "unknown provenance" token sentinel, start invites.
  =/  up-doc-7-to-8
    |=  d=state-7-document
    ^-  state-8-document
    :*  doc-type=doc-type.d
        title=title.d
        created=created.d
        modified=modified.d
        parent=parent.d
        acl=acl.d
        updates=updates.d
        snapshot=snapshot.d
        comments=comments.d
        trashed=trashed.d
    ==
  =/  up-mirror-7-to-8
    |=  m=state-7-mirror
    ^-  mirror
    :*  owner=owner.m
        doc-type=doc-type.m
        title=title.m
        role=role.m
        cached=cached.m
        tail=tail.m
        next-seq=0
        pending=~
        comments=*(map @uv comment)
    ==
  =/  up-session-7-to-8
    |=  t=state-7-session
    ^-  token-session
    [doc-id.t role.t expires.t 0v0]
  =/  up-to-8
    |=  s7=state-7
    ^-  state-8
    :*  %8
        (~(run by docs.s7) up-doc-7-to-8)
        (~(run by mirrors.s7) up-mirror-7-to-8)
        tokens.s7
        (~(run by sessions.s7) up-session-7-to-8)
        sse-clients.s7
        blobs.s7
        children.s7
        pending-sse.s7
        *(map doc-id invite)
    ==
  ::  v8 → v9: stamp buffered updates with the only honest guess (owner
  ::  authored, at the doc's modified time), start empty versions, add
  ::  the starred set.
  =/  up-doc-8-to-9
    |=  d=state-8-document
    ^-  document
    :*  doc-type=doc-type.d
        title=title.d
        created=created.d
        modified=modified.d
        parent=parent.d
        acl=acl.d
        %+  turn  updates.d
        |=(u=octs `stamped-update`[modified.d our.bowl u])
        snapshot=snapshot.d
        versions=~
        comments=comments.d
        trashed=trashed.d
    ==
  =/  up-to-9
    |=  s8=state-8
    ^-  state-9
    :*  %9
        (~(run by docs.s8) up-doc-8-to-9)
        mirrors.s8
        tokens.s8
        sessions.s8
        sse-clients.s8
        blobs.s8
        children.s8
        pending-sse.s8
        invites.s8
        *(set doc-id)
    ==
  ::  v9 → v10: add the empty thumbnails map.
  =/  up-to-10
    |=  s9=state-9
    ^-  state-10
    :*  %10
        docs.s9  mirrors.s9  tokens.s9  sessions.s9  sse-clients.s9
        blobs.s9  children.s9  pending-sse.s9  invites.s9  starred.s9
        *(map doc-id octs)
    ==
  ::  v10 → v11: add empty spaces + doc→space maps (spaces).
  =/  up-to-11
    |=  s10=state-10
    ^-  state-11
    :*  %11
        docs.s10  mirrors.s10  tokens.s10  sessions.s10  sse-clients.s10
        blobs.s10  children.s10  pending-sse.s10  invites.s10  starred.s10
        thumbs.s10
        *(map space-id space)
        *(map doc-id space-id)
        *(map space-id space-mirror)
        *(map space-id space-invite)
    ==
  ::  v11 → v12: add empty per-space chat logs + read stamps + DM threads.
  =/  up-to-12
    |=  s11=state-11
    ^-  state-12
    :*  %12
        docs.s11  mirrors.s11  tokens.s11  sessions.s11  sse-clients.s11
        blobs.s11  children.s11  pending-sse.s11  invites.s11  starred.s11
        thumbs.s11  spaces.s11  doc-space.s11  space-mirrors.s11
        space-invites.s11
        *(map space-id (list chat-msg))
        *(map space-id @da)
        *(map @p dm-thread)
    ==
  =/  up-to-13
    |=  s12=state-12
    ^-  state-13
    :*  %13
        docs.s12  mirrors.s12  tokens.s12  sessions.s12  sse-clients.s12
        blobs.s12  children.s12  pending-sse.s12  invites.s12  starred.s12
        thumbs.s12  spaces.s12  doc-space.s12  space-mirrors.s12
        space-invites.s12  space-chat.s12  space-read.s12  dms.s12
        ''  *(map @p @t)
    ==
  =/  s  !<(versioned-state old)
  ?-  -.s
      %13  [rebind this(state s)]
      %12  [rebind this(state (up-to-13 s))]
      %11  [rebind this(state (up-to-13 (up-to-12 s)))]
      %10  [rebind this(state (up-to-13 (up-to-12 (up-to-11 s))))]
      %9  [rebind this(state (up-to-13 (up-to-12 (up-to-11 (up-to-10 s)))))]
      %8  [rebind this(state (up-to-13 (up-to-12 (up-to-11 (up-to-10 (up-to-9 s))))))]
      %7  [rebind this(state (up-to-13 (up-to-12 (up-to-11 (up-to-10 (up-to-9 (up-to-8 s)))))))]
      %6
    =/  upgraded-docs=(map doc-id state-7-document)
      (~(run by docs-pre-trash.s) upgrade-doc-6-to-7)
    =/  s7=state-7
      :*  %7
          upgraded-docs
          mirrors.s
          tokens.s
          sessions.s
          sse-clients.s
          blobs.s
          children.s
          pending-sse.s
      ==
    [rebind this(state (up-to-13 (up-to-12 (up-to-11 (up-to-10 (up-to-9 (up-to-8 s7)))))))]
      %5
    =/  upgraded-docs=(map doc-id state-7-document)
      (~(run by docs-pre-anchor.s) upgrade-doc-5-to-6)
    =/  s7=state-7
      :*  %7
          upgraded-docs
          mirrors.s
          tokens.s
          sessions.s
          sse-clients.s
          blobs.s
          children.s
          pending-sse.s
      ==
    [rebind this(state (up-to-13 (up-to-12 (up-to-11 (up-to-10 (up-to-9 (up-to-8 s7)))))))]
      %4
    =/  upgraded-docs=(map doc-id state-7-document)
      (~(run by docs-pre-comments.s) upgrade-doc-4-to-5)
    =/  s7=state-7
      :*  %7
          upgraded-docs
          mirrors.s
          tokens.s
          sessions.s
          sse-clients.s
          blobs.s
          children.s
          pending-sse.s
      ==
    [rebind this(state (up-to-13 (up-to-12 (up-to-11 (up-to-10 (up-to-9 (up-to-8 s7)))))))]
      %3
    =/  upgraded-docs=(map doc-id state-7-document)
      (~(run by docs.s) upgrade-doc-4-to-5)
    =/  s7=state-7
      :*  %7
          upgraded-docs
          mirrors.s
          tokens.s
          sessions.s
          sse-clients.s
          blobs.s
          children.s
          *(list pending-sse-event)
      ==
    [rebind this(state (up-to-13 (up-to-12 (up-to-11 (up-to-10 (up-to-9 (up-to-8 s7)))))))]
      %2
    =/  upgraded-docs=(map doc-id state-7-document)
      (~(run by docs-pre-octs.s) upgrade-doc-2-to-3)
    =/  upgraded-mirrors=(map doc-id state-7-mirror)
      (~(run by mirrors-pre-octs.s) upgrade-mirror-2-to-3)
    =/  s7=state-7
      :*  %7
          upgraded-docs
          upgraded-mirrors
          tokens.s
          sessions.s
          sse-clients.s
          blobs.s
          children.s
          *(list pending-sse-event)
      ==
    [rebind this(state (up-to-13 (up-to-12 (up-to-11 (up-to-10 (up-to-9 (up-to-8 s7)))))))]
      %1
    =/  upgraded-docs=(map doc-id state-7-document)
      (~(run by docs-old.s) upgrade-doc-1-to-3)
    =/  upgraded-mirrors=(map doc-id state-7-mirror)
      (~(run by mirrors-old.s) upgrade-mirror-1-to-3)
    =/  upgraded-blobs=(map doc-id file-blob)
      (~(run by images.s) upgrade-blob-1-to-3)
    =/  s7=state-7
      :*  %7
          upgraded-docs
          upgraded-mirrors
          tokens.s
          sessions.s
          sse-clients.s
          upgraded-blobs
          (rebuild-children upgraded-docs)
          *(list pending-sse-event)
      ==
    [rebind this(state (up-to-13 (up-to-12 (up-to-11 (up-to-10 (up-to-9 (up-to-8 s7)))))))]
      %0
    =/  upgraded-docs=(map doc-id state-7-document)
      (~(run by docs-v0.s) upgrade-doc-1-to-3)
    =/  upgraded-mirrors=(map doc-id state-7-mirror)
      (~(run by mirrors-v0.s) upgrade-mirror-1-to-3)
    =/  s7=state-7
      :*  %7
          upgraded-docs
          upgraded-mirrors
          tokens.s
          sessions.s
          sse-clients.s
          *(map doc-id file-blob)
          (rebuild-children upgraded-docs)
          *(list pending-sse-event)
      ==
    [rebind this(state (up-to-13 (up-to-12 (up-to-11 (up-to-10 (up-to-9 (up-to-8 s7)))))))]
  ==
::
++  on-poke
  |=  [=mark =vase]
  ^-  (quip card _this)
  =^  cards  state  (handle-poke:cor mark vase)
  [cards this]
::
++  on-watch
  |=  =path
  ^-  (quip card _this)
  =^  cards  state  (handle-watch:cor path)
  [cards this]
::
++  on-leave
  |=  =path
  ^-  (quip card _this)
  =^  cards  state  (handle-leave:cor path)
  [cards this]
::
++  on-agent
  |=  [=wire =sign:agent:gall]
  ^-  (quip card _this)
  =^  cards  state  (handle-agent:cor wire sign)
  [cards this]
::
++  on-arvo
  |=  [=wire =sign-arvo]
  ^-  (quip card _this)
  =^  cards  state  (handle-arvo:cor wire sign-arvo)
  [cards this]
::
++  on-fail   on-fail:def
++  on-peek   peek:cor
--
::
::  Helper core. Sample carries bowl + state. Helpers return (quip card _state).
::
|_  [=bowl:gall state=state-13]
+*  docs         docs.state
    mirrors      mirrors.state
    tokens       tokens.state
    sessions     sessions.state
    sse-clients  sse-clients.state
    blobs        blobs.state
    children     children.state
    pending-sse  pending-sse.state
    invites      invites.state
    starred      starred.state
    thumbs       thumbs.state
    spaces       spaces.state
    doc-space    doc-space.state
    space-mirrors  space-mirrors.state
    space-invites  space-invites.state
    space-chat   space-chat.state
    space-read   space-read.state
    dms          dms.state
    my-nickname  my-nickname.state
    nicknames    nicknames.state
::
::  =================================================================
::  init / dispatchers
::  =================================================================
::
++  init
  ^-  (quip card _state)
  :_  state
  :~  [%pass /eyre/connect %arvo %e %connect [~ /drive] %drive]
      [%pass /keepalive %arvo %b %wait (add now.bowl ~s25)]
      [%pass /session-sweep %arvo %b %wait (add now.bowl ~m5)]
      [%pass /trash-sweep %arvo %b %wait (add now.bowl ~h1)]
  ==
::
++  handle-poke
  |=  [=mark =vase]
  ^-  (quip card _state)
  ?+  mark  `state
      %handle-http-request
    =+  !<([eyre-id=@ta =inbound-request:eyre] vase)
    (handle-http eyre-id inbound-request)
    ::
      %drive-action
    ?>  =(src.bowl our.bowl)
    =+  !<(=action vase)
    (handle-action-feed action)
    ::
      %drive-update-poke
    =+  !<(=update-poke vase)
    (recv-remote-update src.bowl update-poke)
    ::
      %drive-awareness-poke
    =+  !<(=awareness-poke vase)
    (recv-remote-awareness src.bowl awareness-poke)
    ::
      %drive-comment-poke
    =+  !<(=comment-poke vase)
    (recv-remote-comment src.bowl comment-poke)
    ::
      %drive-share-notice
    =+  !<(n=share-notice vase)
    (recv-share-notice src.bowl n)
    ::
      %drive-share-retract
    =+  !<(r=share-retract vase)
    (recv-share-retract src.bowl r)
    ::
      %drive-space-invite-notice
    =+  !<(n=space-invite-notice vase)
    (recv-space-invite-notice src.bowl n)
    ::
      %drive-space-invite-decline
    =+  !<(d=space-invite-decline vase)
    (recv-space-invite-decline src.bowl d)
    ::
      %drive-space-chat-poke
    =+  !<(p=space-chat-poke vase)
    (recv-space-chat-poke src.bowl p)
    ::
      %drive-dm-poke
    =+  !<(d=dm-poke vase)
    (recv-dm-poke src.bowl d)
    ::
      %drive-set-nickname-poke
    =+  !<(p=set-nickname-poke vase)
    (recv-set-nickname src.bowl p)
  ==
::
++  handle-watch
  |=  =path
  ^-  (quip card _state)
  ?+  path  `state
      [%http-response @ ~]  `state
      [%doc @ ~]
    =/  did=doc-id  (slav %uv i.t.path)
    (handle-watch-doc src.bowl did)
      [%space @ ~]
    =/  sid=space-id  (slav %uv i.t.path)
    (handle-watch-space src.bowl sid)
  ==
::
++  handle-leave
  |=  =path
  ^-  (quip card _state)
  ?+  path  `state
      [%doc @ ~]
    =/  did=doc-id  (slav %uv i.t.path)
    (handle-leave-doc src.bowl did)
      [%space @ ~]  `state
      [%http-response @ ~]
    =/  eid=@ta  i.t.path
    `state(sse-clients (~(del by sse-clients) eid))
  ==
::
++  handle-agent
  |=  [=wire =sign:agent:gall]
  ^-  (quip card _state)
  ?+  wire  `state
      [%mirror @ ~]
    =/  did=doc-id  (slav %uv i.t.wire)
    ?-  -.sign
        %watch-ack
      ?~  p.sign
        ::  (Re)subscribed — replay any un-acked forwarded edits. Covers
        ::  "role restored after a kick": the outbox survives the outage.
        =/  m  (~(get by mirrors) did)
        ?~  m  `state
        :_  state
        %+  turn  (flop pending.u.m)
        |=  pnd=pending-update
        (forward-update-card did owner.u.m seq.pnd u.pnd)
      ::  Watch refused → our access is gone. fanout-fact (NOT a raw %give)
      ::  so local browsers on SSE hear %revoked too, then drop the mirror.
      =^  fan  state  (fanout-fact did %revoked ~)
      :_  state(mirrors (~(del by mirrors) did))
      (snoc fan [%give %kick ~[/doc/(scot %uv did)] ~])
        %kick
      ?:  (has-local-watchers did)
        =/  m  (~(get by mirrors) did)
        ?~  m  `state
        :_  state
        :~  [%pass /mirror/(scot %uv did) %agent [owner.u.m %drive] %watch /doc/(scot %uv did)]
        ==
      `state(mirrors (~(del by mirrors) did))
        %fact
      ?+  p.cage.sign  `state
          %drive-fact
        =+  !<(=fact q.cage.sign)
        (handle-mirror-fact did fact)
      ==
        %poke-ack  `state
    ==
    ::
      [%forward @ @ ~]
    ::  Settle one outbox entry by its seq.
    =/  did=doc-id  (slav %uv i.t.wire)
    =/  seq=@ud  (slav %ud i.t.t.wire)
    ?.  ?=(%poke-ack -.sign)  `state
    =/  m  (~(get by mirrors) did)
    ?~  m  `state
    ?~  p.sign
      ::  Acked: the owner has it.
      =/  m2
        u.m(pending (skip pending.u.m |=(pnd=pending-update =(seq.pnd seq))))
      `state(mirrors (~(put by mirrors) did m2))
    ::  Nacked: the owner's agent rejected it (revoked role, purged doc,
    ::  crash). Retry with backoff up to 3 tries, then tell the local
    ::  browser the save failed. The entry stays in pending: a later
    ::  re-watch (role restored) replays it.
    =/  entry
      (skim pending.u.m |=(pnd=pending-update =(seq.pnd seq)))
    ?~  entry  `state
    =/  pnd  i.entry
    ?:  (gte tries.pnd 3)
      (fanout-fact did %save-failed ~)
    =/  m2
      %=    u.m
          pending
        %+  turn  pending.u.m
        |=  q=pending-update
        ?.(=(seq.q seq) q q(tries +(tries.q)))
      ==
    =.  state  state(mirrors (~(put by mirrors) did m2))
    =/  delay=@dr  (mul ~s5 (bex tries.pnd))
    :_  state
    :~  :*  %pass  /forward-retry/(scot %uv did)/(scot %ud seq)
            %arvo  %b  %wait  (add now.bowl delay)
        ==
    ==
    ::
      [%forward-awareness @ ~]
    `state
    ::
      [%space-mirror @ ~]
    =/  sid=space-id  (slav %uv i.t.wire)
    ?-  -.sign
        %watch-ack
      ::  Refused → not (or no longer) a member: drop the joined space and
      ::  refresh the listing so an optimistically-shown space disappears.
      ?~  p.sign  `state
      =^  feed  state  fanout-listing
      [feed state(space-mirrors (~(del by space-mirrors) sid))]
        %kick
      ::  Host kicked us (removed / space deleted): drop it, don't re-watch.
      =^  feed  state  fanout-listing
      [feed state(space-mirrors (~(del by space-mirrors) sid))]
        %fact
      ?+  p.cage.sign  `state
          %drive-fact
        =+  !<(=fact q.cage.sign)
        (handle-space-mirror-fact sid fact)
      ==
        %poke-ack  `state
    ==
  ==
::
++  handle-arvo
  |=  [=wire =sign-arvo]
  ^-  (quip card _state)
  ?+  wire  `state
      [%eyre %connect ~]  `state
      [%eyre %disconnect ~]  `state
      [%keepalive ~]
    ?>  ?=([%behn %wake *] sign-arvo)
    =/  cards=(list card)
      %+  roll  ~(tap by sse-clients)
      |=  [[eid=@ta *] acc=(list card)]
      (weld acc (ping:schooner-stream eid))
    =/  rearm=card
      [%pass /keepalive %arvo %b %wait (add now.bowl ~s25)]
    [(snoc cards rearm) state]
      [%forward-retry @ @ ~]
    ::  Re-poke one still-pending outbox entry after its backoff.
    ?>  ?=([%behn %wake *] sign-arvo)
    =/  did=doc-id  (slav %uv i.t.wire)
    =/  seq=@ud  (slav %ud i.t.t.wire)
    =/  m  (~(get by mirrors) did)
    ?~  m  `state
    =/  entry
      (skim pending.u.m |=(pnd=pending-update =(seq.pnd seq)))
    ?~  entry  `state
    :_  state
    ~[(forward-update-card did owner.u.m seq u.i.entry)]
    ::
      [%sse-flush ~]
    ::  Drain pending-sse: emit SSE chunks for each queued event in this
    ::  separate move (so they actually flush — eyre buffers chunks emitted
    ::  in the same move as another response).
    ?>  ?=([%behn %wake *] sign-arvo)
    =/  cards=(list card)
      %+  roll  pending-sse
      |=  [ev=pending-sse-event acc=(list card)]
      (weld acc (send:schooner-stream eid.ev 'fact' data.ev))
    [cards state(pending-sse ~)]
      [%session-sweep ~]
    ::  Walk sessions, kick any whose expiry has passed; rearm in 5min.
    ?>  ?=([%behn %wake *] sign-arvo)
    =/  bad-sids=(set @uv)
      %-  silt
      %+  murn  ~(tap by sessions)
      |=  [sid=@uv sess=token-session]
      ^-  (unit @uv)
      ?:((lth expires.sess now.bowl) `sid ~)
    =^  cards  state  (kill-sessions bad-sids)
    =/  rearm=card
      [%pass /session-sweep %arvo %b %wait (add now.bowl ~m5)]
    [(snoc cards rearm) state]
      [%trash-sweep ~]
    ::  Walk trashed docs older than 30 days; hard-purge them. Rearm hourly.
    ?>  ?=([%behn %wake *] sign-arvo)
    =/  to-purge=(list doc-id)
      %+  murn  ~(tap by docs)
      |=  [did=doc-id d=document]
      ^-  (unit doc-id)
      ?~  trashed.d  ~
      ?:  (gth (sub now.bowl u.trashed.d) ~d30)  `did
      ~
    =/  rearm=card
      [%pass /trash-sweep %arvo %b %wait (add now.bowl ~h1)]
    =|  cards=(list card)
    |-  ^-  (quip card _state)
    ?~  to-purge  [(snoc cards rearm) state]
    =^  c1  state  (do-purge i.to-purge)
    $(to-purge t.to-purge, cards (weld cards c1))
      [%forward *]  `state
      [%mirror *]  `state
  ==
::
++  peek
  |=  =path
  ^-  (unit (unit cage))
  ?+  path  ~
      [%x %listing ~]
    ``json+!>(enjs-listing)
      [%x %doc @ ~]
    =/  did  (slav %uv i.t.t.path)
    ``json+!>((enjs-doc-meta did))
      [%x %doc @ %state ~]
    =/  did  (slav %uv i.t.t.path)
    ``json+!>((enjs-doc-state did))
      [%x %tokens %for @ ~]
    =/  did  (slav %uv i.t.t.t.path)
    ``json+!>((enjs-tokens-for did))
      [%x %comments %for @ ~]
    =/  did  (slav %uv i.t.t.t.path)
    ``json+!>((enjs-comments-for did))
      [%x %folder @ %contents ~]
    =/  seg=@ta  i.t.t.path
    =/  pkey=doc-id
      ?:  =('root' seg)  0v0
      (slav %uv seg)
    ``json+!>((enjs-folder-contents pkey))
      [%x %trash ~]
    ``json+!>(enjs-trash-listing)
      [%x %doc @ %history ~]
    =/  did  (slav %uv i.t.t.path)
    ``json+!>((enjs-doc-history did))
      [%x %doc @ %versions ~]
    =/  did  (slav %uv i.t.t.path)
    ``json+!>((enjs-versions did))
      [%x %usage ~]
    ``json+!>(enjs-usage)
      [%x %space @ ~]
    =/  sid  (slav %uv i.t.t.path)
    ``json+!>((enjs-space sid))
      [%x %space-docs @ ~]
    =/  sid  (slav %uv i.t.t.path)
    ``json+!>((enjs-space-docs sid))
      [%x %chat @ ~]
    =/  sid  (slav %uv i.t.t.path)
    ``json+!>((enjs-chat sid))
      [%x %dms ~]
    ``json+!>(enjs-dms)
      [%x %dm @ ~]
    =/  who  (rash i.t.t.path fed:ag)
    ``json+!>((enjs-dm who))
      [%x %health ~]
    ``json+!>(enjs-health)
  ==
::
::  =================================================================
::  ACL / role helpers
::  =================================================================
::
++  role-rank
  |=  =role
  ^-  @ud
  ?-  role
    %owner      4
    %editor     3
    %commenter  2
    %viewer     1
  ==
::
++  has-role
  |=  [actual=role needed=role]
  ^-  ?
  (gte (role-rank actual) (role-rank needed))
::
::  a space membership grants a doc-level role: %admin/%owner get full
::  (owner-equivalent) doc access; the lower tiers map straight across.
++  space-role-to-role
  |=  sr=space-role
  ^-  role
  ?-  sr
    %owner      %owner
    %admin      %owner
    %editor     %editor
    %commenter  %commenter
    %viewer     %viewer
  ==
::
::  the doc-role `who` gets via the doc's space membership, if any.
++  space-role-for
  |=  [did=doc-id who=@p]
  ^-  (unit role)
  =/  sid  (~(get by doc-space) did)
  ?~  sid  ~
  =/  spc  (~(get by spaces) u.sid)
  ?~  spc  ~
  =/  mr  (~(get by members.u.spc) who)
  ?~  mr  ~
  `(space-role-to-role u.mr)
::
::  is `who` allowed to manage the space (add/remove members, rename)?
++  space-manager
  |=  [sid=space-id who=@p]
  ^-  ?
  =/  spc  (~(get by spaces) sid)
  ?~  spc  %.n
  =/  mr  (~(get by members.u.spc) who)
  ?~  mr  %.n
  ?=(?(%owner %admin) u.mr)
::
::  a ship's effective role on a doc = the GREATER of its per-doc acl grant
::  and its space-membership grant. Space access is thus additive and never
::  weakens an explicit per-doc share.
++  ship-role
  |=  [did=doc-id doc=document who=@p]
  ^-  (unit role)
  ?:  =(who our.bowl)  `%owner
  =/  acl-r  (~(get by acl.doc) who)
  =/  spc-r  (space-role-for did who)
  ?~  acl-r  spc-r
  ?~  spc-r  acl-r
  ?:  (gte (role-rank u.acl-r) (role-rank u.spc-r))  acl-r
  spc-r
::
++  check-role
  |=  [did=doc-id doc=document who=@p needed=role]
  ^-  ?
  =/  r  (ship-role did doc who)
  ?~  r  %.n
  (has-role u.r needed)
::
::  =================================================================
::  ID/token minting
::  =================================================================
::
++  fresh-doc-id
  ^-  doc-id
  `@uv`(shaz (mix eny.bowl `@`now.bowl))
::
++  fresh-space-id
  ^-  space-id
  `@uv`(shaz (mix (mix eny.bowl `@`now.bowl) 'space'))
::
++  fresh-token
  ^-  @uv
  `@uv`(shaz (mix (mix eny.bowl `@`now.bowl) (shaz now.bowl)))
::
++  fresh-session
  ^-  @uv
  `@uv`(shaz (mix (mix eny.bowl 'session') `@`now.bowl))
::
::  =================================================================
::  Subscription / SSE bookkeeping via bowl
::  =================================================================
::
++  has-local-watchers
  |=  did=doc-id
  ^-  ?
  ::  Local browsers watch via SSE, not gall subscriptions — count both,
  ::  else a transient kick drops the mirror out from under an open tab.
  ?:  !=(~ (sse-clients-for did))  &
  =/  pax  /doc/(scot %uv did)
  %+  lien  ~(tap by sup.bowl)
  |=  [sub-id=duct [who=@p =path]]
  =(path pax)
::
++  sse-clients-for
  |=  did=doc-id
  ^-  (list @ta)
  %+  murn  ~(tap by sse-clients)
  |=  [eid=@ta sub=sse-sub]
  ?:(=(doc-id.sub did) `eid ~)
::
::  kill-sessions: close SSE streams owned by the named sessions, kick their
::  /doc subscriptions, and drop them from `sessions`. Shared between
::  %revoke-token (manual revoke) and the periodic session-sweep alarm.
::
++  kill-sessions
  |=  sids=(set @uv)
  ^-  (quip card _state)
  ?:  =(0 ~(wyt in sids))  `state
  ::  Find the SSE streams those sessions are using, and the docs they watch.
  =/  bad=(list [eid=@ta did=doc-id])
    %+  murn  ~(tap by sse-clients)
    |=  [eid=@ta sub=sse-sub]
    ^-  (unit [@ta doc-id])
    ?:((~(has in sids) session.sub) `[eid doc-id.sub] ~)
  =/  end-cards=(list card)
    %+  turn  bad
    |=  [eid=@ta *]
    ^-  card
    ::  Close the HTTP-response subscription (Eyre will tear down the SSE).
    :+  %give  %fact
    [~[/http-response/[eid]] %http-response-data !>(`(unit octs)`~)]
  =/  kick-http-cards=(list card)
    %+  turn  bad
    |=  [eid=@ta *]
    ^-  card
    [%give %kick ~[/http-response/[eid]] ~]
  =/  kick-doc-cards=(list card)
    %+  turn  bad
    |=  [* did=doc-id]
    ^-  card
    [%give %kick ~[/doc/(scot %uv did)] ~]
  =/  bad-eids=(list @ta)  (turn bad |=([eid=@ta *] eid))
  =.  state
    %=    state
        sessions
      %+  roll  ~(tap in sids)
      |=  [sid=@uv ss=_sessions.state]
      (~(del by ss) sid)
    ::
        sse-clients
      %+  roll  bad-eids
      |=  [eid=@ta sc=_sse-clients.state]
      (~(del by sc) eid)
    ==
  [:(weld end-cards kick-http-cards kick-doc-cards) state]
::
::  do-soft-delete: stamp `trashed=(some now)` so listing skips the doc;
::  emit a %trashed fact (live editors disconnect and route back to files).
::
::  All transitive descendants of a doc, via the children index.
++  descendants
  |=  did=doc-id
  ^-  (list doc-id)
  =/  todo=(list doc-id)  ~(tap in (~(gut by children) did *(set doc-id)))
  =|  acc=(list doc-id)
  |-
  ?~  todo  acc
  =/  kids=(list doc-id)
    ~(tap in (~(gut by children) i.todo *(set doc-id)))
  $(todo (weld t.todo kids), acc [i.todo acc])
::
++  do-soft-delete
  |=  did=doc-id
  ^-  (quip card _state)
  =/  doc  (~(get by docs) did)
  ?~  doc  `state
  ?^  trashed.u.doc  `state
  ::  Trash the whole subtree with ONE shared timestamp. Restore matches
  ::  on that stamp, so a child that was trashed independently earlier
  ::  keeps its own stamp and stays in the trash when the folder returns.
  =/  stamp  now.bowl
  =/  targets=(list doc-id)  [did (descendants did)]
  =|  cards=(list card)
  |-
  ?~  targets  [cards state]
  =/  d  (~(get by docs) i.targets)
  ?:  |(?=(~ d) ?=(^ trashed.u.d))
    $(targets t.targets)
  =.  state
    state(docs (~(put by docs) i.targets u.d(trashed `stamp, modified stamp)))
  =^  fan  state  (fanout-fact i.targets %trashed stamp)
  ::  drop it from space members' lists too (a trashed doc isn't listed)
  =/  gone  (space-doc-drop i.targets)
  $(targets t.targets, cards :(weld cards fan gone))
::
::  do-restore: clear `trashed` on the doc and every descendant that was
::  trashed in the same cascade. Emits %meta so listings refresh.
::
++  do-restore
  |=  did=doc-id
  ^-  (quip card _state)
  =/  doc  (~(get by docs) did)
  ?~  doc  `state
  ?~  trashed.u.doc  `state
  =/  stamp  u.trashed.u.doc
  =/  targets=(list doc-id)  [did (descendants did)]
  =|  cards=(list card)
  |-
  ?~  targets  [cards state]
  =/  d  (~(get by docs) i.targets)
  ?:  |(?=(~ d) ?=(~ trashed.u.d))
    $(targets t.targets)
  ?.  =(u.trashed.u.d stamp)
    $(targets t.targets)
  =.  state
    state(docs (~(put by docs) i.targets u.d(trashed ~, modified now.bowl)))
  =^  fan  state
    (fanout-fact i.targets %meta title.u.d now.bowl doc-type.u.d)
  ::  re-advertise it to space members (it's live again)
  =/  back  (space-doc-refresh i.targets)
  $(targets t.targets, cards :(weld cards fan back))
::
::  do-purge: hard-delete a doc AND its whole subtree — drop docs, blobs,
::  children entries, matching token grants; kill matching sessions; emit
::  %revoked + kick lingering watchers per doc. Used by manual %purge and
::  the hourly trash-sweep for items older than 30 days.
::
++  do-purge
  |=  did=doc-id
  ^-  (quip card _state)
  =/  doc  (~(get by docs) did)
  ?~  doc  `state
  ::  Detach the root from its parent's sibling set (descendants' parent
  ::  entries are deleted wholesale below).
  =/  pkey=doc-id  ?~(parent.u.doc 0v0 u.parent.u.doc)
  =/  siblings  (~(gut by children) pkey *(set doc-id))
  =.  state
    state(children (~(put by children) pkey (~(del in siblings) did)))
  =/  targets=(list doc-id)  [did (descendants did)]
  =|  cards=(list card)
  |-
  ?~  targets  [cards state]
  =/  tid  i.targets
  =/  doomed-tokens=(list @uv)
    %+  murn  ~(tap by tokens)
    |=  [tok=@uv g=token-grant]
    ^-  (unit @uv)
    ?:(=(doc-id.g tid) `tok ~)
  =/  bad-sids=(set @uv)
    %-  silt
    %+  murn  ~(tap by sessions)
    |=  [sid=@uv sess=token-session]
    ^-  (unit @uv)
    ?:(=(doc-id.sess tid) `sid ~)
  =^  kill-cards  state  (kill-sessions bad-sids)
  =^  fan-cards  state  (fanout-fact tid %revoked ~)
  =/  kick-card=card  [%give %kick ~[/doc/(scot %uv tid)] ~]
  ::  tell space members it's gone — MUST read doc-space before we clear it
  =/  gone  (space-doc-drop tid)
  =/  toks2=(map @uv token-grant)
    %+  roll  doomed-tokens
    |:  [t=`@uv`0v0 acc=`(map @uv token-grant)`tokens]
    (~(del by acc) t)
  =.  state
    %=  state
      docs       (~(del by docs) tid)
      blobs      (~(del by blobs) tid)
      thumbs     (~(del by thumbs) tid)
      children   (~(del by children) tid)
      doc-space  (~(del by doc-space) tid)
      tokens     toks2
    ==
  %=  $
    targets  t.targets
    cards    :(weld cards kill-cards fan-cards ~[kick-card] gone)
  ==
::
::  =================================================================
::  Bytes <-> JSON
::  =================================================================
::
::  bytes-to-json: encode octs as a JSON byte array, padding the rip output
::  with trailing zeros up to the recorded size. Critical for Yjs updates
::  whose binary encoding can include trailing 0x00 bytes — those bytes
::  vanish when the atom is rip'd because (met) doesn't see them.
::
++  bytes-to-json
  |=  =octs
  ^-  json
  :-  %a
  =/  bs=(list @ud)  (rip 3 q.octs)
  =/  pad=@ud
    ?:  (gth p.octs (lent bs))  (sub p.octs (lent bs))
    0
  =/  padded=(list @ud)  (weld bs (reap pad 0))
  %+  turn  padded
  |=(b=@ud (numb:enjs:format b))
::
++  json-to-string
  |=  =json
  ^-  @t
  (en:json:html json)
::
++  dejs-action
  =,  dejs:format
  ^-  $-(json action)
  =/  d-fist  `$-(json doc-id)`(cu |=(s=@t (slav %uv s)) so)
  =/  uv-fist  `$-(json @uv)`(cu |=(s=@t (slav %uv s)) so)
  =/  parent-fist
    ^-  $-(json (unit doc-id))
    |=  j=json
    ?~  j  ~
    ?:  ?=([%s *] j)  ?:(=('' p.j) ~ `(slav %uv p.j))
    ~|('parent must be string or null' !!)
  =/  p-fist   (su fed:ag)
  =/  r-fist
    ^-  $-(json role)
    (su (perk %owner %editor %commenter %viewer ~))
  =/  sr-fist
    ^-  $-(json space-role)
    (su (perk %owner %admin %editor %commenter %viewer ~))
  =/  space-opt-fist
    ^-  $-(json (unit space-id))
    |=  j=json
    ?~  j  ~
    ?:  ?=([%s *] j)  ?:(=('' p.j) ~ `(slav %uv p.j))
    ~|('space must be string or null' !!)
  =/  t-fist
    ^-  $-(json doc-type)
    (su (perk %text %sheet %note %image %file %folder ~))
  =/  b-fist
    |=  j=json
    ^-  octs
    =/  bs=(list @ud)  ((ar ni) j)
    [(lent bs) (rep 3 bs)]
  %-  of
  :~  [%create (ot ~[doc-type+t-fist title+so parent+parent-fist])]
      [%create-folder (ot ~[title+so parent+parent-fist])]
      [%rename (ot ~[id+d-fist title+so])]
      [%delete d-fist]
      [%move (ot ~[id+d-fist parent+parent-fist])]
      [%share (ot ~[id+d-fist who+p-fist role+r-fist])]
      [%revoke (ot ~[id+d-fist who+p-fist])]
      [%mint-token (ot ~[id+d-fist role+r-fist])]
      [%revoke-token uv-fist]
      [%subscribe-remote (ot ~[owner+p-fist id+d-fist])]
      [%unsubscribe-remote d-fist]
      [%submit-update (ot ~[id+d-fist update+b-fist])]
      [%submit-awareness (ot ~[id+d-fist blob+b-fist])]
      [%submit-snapshot (ot ~[id+d-fist gen+ni covered+ni blob+b-fist])]
      [%add-comment (ot ~[id+d-fist comment-id+uv-fist text+so anchor+so])]
      [%resolve-comment (ot ~[id+d-fist comment-id+uv-fist])]
      [%delete-comment (ot ~[id+d-fist comment-id+uv-fist])]
      [%restore d-fist]
      [%star (ot ~[id+d-fist on+bo])]
      [%copy d-fist]
      [%save-version (ot ~[id+d-fist label+so blob+b-fist])]
      [%purge d-fist]
      [%bulk-delete (ot ~[docs+(ar d-fist)])]
      [%bulk-restore (ot ~[docs+(ar d-fist)])]
      [%bulk-purge (ot ~[docs+(ar d-fist)])]
      [%bulk-move (ot ~[docs+(ar d-fist) new-parent+(mu d-fist)])]
      [%create-space (ot ~[name+so])]
      [%rename-space (ot ~[space+uv-fist name+so])]
      [%delete-space uv-fist]
      [%add-member (ot ~[space+uv-fist who+p-fist role+sr-fist])]
      [%remove-member (ot ~[space+uv-fist who+p-fist])]
      [%set-member-role (ot ~[space+uv-fist who+p-fist role+sr-fist])]
      [%set-doc-space (ot ~[id+d-fist space+space-opt-fist])]
      [%join-space (ot ~[host+p-fist space+uv-fist])]
      [%leave-space uv-fist]
      [%invite-to-space (ot ~[space+uv-fist who+p-fist role+sr-fist])]
      [%accept-space-invite uv-fist]
      [%decline-space-invite uv-fist]
      [%post-message (ot ~[space+uv-fist text+so])]
      [%delete-message (ot ~[space+uv-fist id+uv-fist])]
      [%read-space uv-fist]
      [%send-dm (ot ~[who+p-fist text+so])]
      [%delete-dm (ot ~[who+p-fist id+uv-fist])]
      [%read-dm p-fist]
      [%set-nickname (ot ~[nick+so])]
  ==
::
::  =================================================================
::  Fan-out facts to gall watchers + SSE clients
::  =================================================================
::
::  fanout-fact: emit gall fact-card immediately; queue SSE chunks for the
::  next behn tick (eyre buffers chunks emitted in the same move as another
::  HTTP response, so we MUST flush them in a separate move).
::
++  fanout-fact
  |=  [did=doc-id =fact]
  ^-  (quip card _state)
  =/  pax=path  /doc/(scot %uv did)
  =/  fact-card=card
    [%give %fact ~[pax] %drive-fact !>(fact)]
  =/  payload=@t  (json-to-string (fact-to-json fact))
  =/  new-events=(list pending-sse-event)
    %+  turn  (sse-clients-for did)
    |=(eid=@ta `pending-sse-event`[eid payload])
  ?:  =(0 (lent new-events))
    [~[fact-card] state]
  =/  was-empty=?  =(0 (lent pending-sse))
  =/  alarm=card  [%pass /sse-flush %arvo %b %wait now.bowl]
  =/  st2  state(pending-sse (weld pending-sse new-events))
  ?:  was-empty  [~[fact-card alarm] st2]
  [~[fact-card] st2]
::
::  Ping every listing-feed subscriber (sse-sub with the 0v0 sentinel
::  doc-id): "something in the listing changed, re-scry". Deliberately no
::  diff payload — the client re-fetches, so Hoon stays dumb and the same
::  ping doubles as the client search-index invalidation signal.
++  fanout-listing
  ^-  (quip card _state)
  =/  payload=@t  '{"type":"listing"}'
  =/  new-events=(list pending-sse-event)
    %+  turn  (sse-clients-for 0v0)
    |=(eid=@ta `pending-sse-event`[eid payload])
  ?:  =(0 (lent new-events))
    [~ state]
  =/  was-empty=?  =(0 (lent pending-sse))
  =/  alarm=card  [%pass /sse-flush %arvo %b %wait now.bowl]
  =/  st2  state(pending-sse (weld pending-sse new-events))
  ?:  was-empty  [~[alarm] st2]
  [~ st2]
::
::  Actions after which listing-feed subscribers should re-scry. Live-edit
::  submits are deliberately excluded: they'd ping on every keystroke.
++  is-listing-mutation
  |=  =action
  ^-  ?
  ?+  -.action  %.n
    %create        %.y
    %create-folder  %.y
    %rename        %.y
    %delete        %.y
    %move          %.y
    %restore       %.y
    %purge         %.y
    %bulk-delete   %.y
    %bulk-restore  %.y
    %bulk-purge    %.y
    %bulk-move     %.y
    %share         %.y
    %revoke        %.y
    %star          %.y
    %copy          %.y
    %subscribe-remote    %.y
    %unsubscribe-remote  %.y
    %create-space    %.y
    %rename-space    %.y
    %delete-space    %.y
    %add-member      %.y
    %remove-member   %.y
    %set-member-role  %.y
    %set-doc-space   %.y
    %join-space      %.y
    %leave-space     %.y
    %invite-to-space  %.y
    %accept-space-invite   %.y
    %decline-space-invite  %.y
  ==
::
::  handle-action plus the listing ping when warranted — the entry point
::  for both the %drive-action poke and POST /drive/action.
++  handle-action-feed
  |=  =action
  ^-  (quip card _state)
  =^  cards  state  (handle-action action)
  ?.  (is-listing-mutation action)  [cards state]
  =^  feed-cards  state  fanout-listing
  [(weld cards feed-cards) state]
::
++  fact-to-json
  |=  =fact
  ^-  json
  =,  enjs:format
  ::  space-channel facts (%space-*) travel over Ames, never the SSE path,
  ::  so they never reach here at runtime; ~ keeps the switch total.
  ?+  -.fact  ~
      %snapshot
    %-  pairs
    :~  type+s+'snapshot'
        seq+(numb seq.fact)
        blob+(bytes-to-json blob.fact)
    ==
      %update
    %-  pairs
    :~  type+s+'update'
        update+(bytes-to-json update.fact)
    ==
      %awareness
    %-  pairs
    :~  type+s+'awareness'
        ship+s+(scot %p ship.fact)
        blob+(bytes-to-json blob.fact)
    ==
      %role-change
    %-  pairs
    :~  type+s+'role-change'
        who+s+(scot %p who.fact)
        role+s+(scot %tas role.fact)
    ==
      %revoked
    %-  pairs  ~[type+s+'revoked']
      %request-snapshot
    %-  pairs  ~[type+s+'request-snapshot']
      %meta
    %-  pairs
    :~  type+s+'meta'
        title+s+title.fact
        modified+(numb (da-to-millis modified.fact))
        doc-type+s+(scot %tas doc-type.fact)
    ==
      %trashed
    %-  pairs
    :~  type+s+'trashed'
        at+(numb (da-to-millis at.fact))
    ==
      %blob
    ::  Never fanned to SSE (bytes-to-json on megabytes is pathological);
    ::  the JSON form exists only to keep this encoder total.
    %-  pairs
    :~  type+s+'blob'
        mime+s+mime.fact
    ==
      %comment-add
    %-  pairs
    :~  type+s+'comment-add'
        id+s+(scot %uv comment-id.fact)
        author+s+(scot %p author.comment.fact)
        text+s+text.comment.fact
        anchor+s+anchor.comment.fact
        created+(numb (da-to-millis created.comment.fact))
        resolved+b+resolved.comment.fact
    ==
      %comment-resolved
    %-  pairs
    :~  type+s+'comment-resolved'
        id+s+(scot %uv comment-id.fact)
    ==
      %comment-deleted
    %-  pairs
    :~  type+s+'comment-deleted'
        id+s+(scot %uv comment-id.fact)
    ==
      %save-failed
    %-  pairs  ~[type+s+'save-failed']
  ==
::
::  =================================================================
::  Doc storage helpers
::  =================================================================
::
++  append-update
  |=  [doc=document author=@p u=octs]
  ^-  document
  doc(updates [[now.bowl author u] updates.doc], modified now.bowl)
::
::  Keep at most 20 unnamed auto-checkpoints; named versions are forever.
::  Walk newest→oldest so the NEWEST 20 unnamed survive; snoc preserves
::  newest-first order in the result (lists here are tiny).
++  push-version
  |=  [doc=document ver=version]
  ^-  document
  =/  result
    %+  roll  `(list version)`[ver versions.doc]
    |:  [v=*version acc=[unnamed=0 keep=*(list version)]]
    ?^  label.v  acc(keep (snoc keep.acc v))
    ?:  (gte unnamed.acc 20)  acc
    [+(unnamed.acc) (snoc keep.acc v)]
  doc(versions keep.result)
::
++  apply-snapshot
  ::  Install a client-encoded snapshot. `gen` must match the live snapshot
  ::  seq — a stale or competing encode is silently dropped. Only the
  ::  `covered` OLDEST updates are truncated (the list is newest-first), so
  ::  updates that arrived while the client was encoding survive. A
  ::  survivor that was also merged into the snapshot is harmless: Yjs
  ::  update application is idempotent. Every accepted compaction also
  ::  becomes an unnamed version checkpoint, crediting the authors of the
  ::  updates it folded in.
  |=  [doc=document author=@p gen=@ud covered=@ud blob=octs]
  ^-  document
  ?.  =(gen seq.snapshot.doc)  doc
  =/  len  (lent updates.doc)
  =/  keep  (sub len (min covered len))
  =/  folded=(list stamped-update)  (slag keep updates.doc)
  =/  contributors=(set @p)
    (silt (turn folded |=(su=stamped-update author.su)))
  =/  ver=version  [now.bowl author contributors ~ blob]
  =/  doc2
    %=  doc
      snapshot  [+(gen) blob]
      updates   (scag keep updates.doc)
      modified  now.bowl
    ==
  (push-version doc2 ver)
::
++  doc-needs-compaction
  |=  doc=document
  ^-  ?
  (gth (lent updates.doc) 500)
::
::  Loom-safety ceiling on any single opaque blob entering agent state.
::  20 MiB matches the /upload cap; a Yjs update is normally KBs and a
::  full-doc snapshot rarely exceeds a few MB, so this only bites abuse.
++  max-blob-bytes  `@ud`20.971.520
::
::  Would this action store an over-cap blob? Guards the update/snapshot/
::  version write paths that the /upload cap doesn't cover (else any editor
::  — including a link-token editor — could bloat the owner's loom).
++  action-oversized
  |=  =action
  ^-  ?
  ?+  -.action  %.n
    %submit-update    (gth p.update.action max-blob-bytes)
    %submit-snapshot  (gth p.blob.action max-blob-bytes)
    %save-version     (gth p.blob.action max-blob-bytes)
  ==
::
::  =================================================================
::  Local action handler (browser → owner ship)
::  =================================================================
::
++  handle-action
  |=  =action
  ^-  (quip card _state)
  ?-  -.action
      %create
    =/  did=doc-id  fresh-doc-id
    =/  =document
      :*  doc-type=doc-type.action
          title=title.action
          created=now.bowl
          modified=now.bowl
          parent=parent.action
          acl=*(map @p role)
          updates=*(list stamped-update)
          snapshot=[seq=0 blob=*octs]
          versions=~
          comments=*(map @uv comment)
          trashed=~
      ==
    =/  pkey=doc-id  ?~(parent.action 0v0 u.parent.action)
    =/  siblings  (~(gut by children) pkey *(set doc-id))
    :-  ~
    %=    state
        docs      (~(put by docs) did document)
        children  (~(put by children) pkey (~(put in siblings) did))
    ==
    ::
      %create-folder
    =/  did=doc-id  fresh-doc-id
    =/  =document
      :*  doc-type=%folder
          title=title.action
          created=now.bowl
          modified=now.bowl
          parent=parent.action
          acl=*(map @p role)
          updates=*(list stamped-update)
          snapshot=[seq=0 blob=*octs]
          versions=~
          comments=*(map @uv comment)
          trashed=~
      ==
    =/  pkey=doc-id  ?~(parent.action 0v0 u.parent.action)
    =/  siblings  (~(gut by children) pkey *(set doc-id))
    :-  ~
    %=    state
        docs      (~(put by docs) did document)
        children  (~(put by children) pkey (~(put in siblings) did))
    ==
    ::
      %move
    =/  doc  (~(get by docs) doc-id.action)
    ?~  doc  `state
    =/  old-pkey=doc-id  ?~(parent.u.doc 0v0 u.parent.u.doc)
    =/  new-pkey=doc-id  ?~(new-parent.action 0v0 u.new-parent.action)
    ?:  =(old-pkey new-pkey)  `state
    =/  old-siblings  (~(gut by children) old-pkey *(set doc-id))
    =/  new-siblings  (~(gut by children) new-pkey *(set doc-id))
    =/  doc2  u.doc(parent new-parent.action, modified now.bowl)
    :-  ~
    %=    state
        docs  (~(put by docs) doc-id.action doc2)
        children
      %-  ~(put by (~(put by children) old-pkey (~(del in old-siblings) doc-id.action)))
      [new-pkey (~(put in new-siblings) doc-id.action)]
    ==
    ::
      %rename
    =/  doc  (~(get by docs) doc-id.action)
    ?~  doc  `state
    =/  doc2  u.doc(title title.action, modified now.bowl)
    =.  state  state(docs (~(put by docs) doc-id.action doc2))
    =^  fan  state  (fanout-fact doc-id.action %meta title.action now.bowl doc-type.u.doc)
    ::  keep space members' doc list titles fresh
    [(weld fan (space-doc-refresh doc-id.action)) state]
    ::
      %delete
    (do-soft-delete doc-id.action)
    ::
      %restore
    (do-restore doc-id.action)
    ::
      %purge
    (do-purge doc-id.action)
    ::
      %star
    ::  Works for any doc-id — owned or mirrored.
    ?:  on.action
      `state(starred (~(put in starred) doc-id.action))
    `state(starred (~(del in starred) doc-id.action))
    ::
      %copy
    ::  Duplicate content only: snapshot + updates carry the Yjs state;
    ::  comments, acl, versions, and star are intentionally NOT copied
    ::  (matches Google's "Make a copy"). Same parent folder.
    =/  src  (~(get by docs) doc-id.action)
    ?~  src  `state
    =/  did=doc-id  fresh-doc-id
    =/  new-title=@t  (cat 3 'Copy of ' title.u.src)
    ::  Re-stamp the copied updates as authored by the copier at copy time:
    ::  a copy carries no borrowed history/authorship (matches Google's
    ::  "Make a copy"). Content is unchanged — only the [at author] stamps.
    =/  copied-updates=(list stamped-update)
      %+  turn  updates.u.src
      |=(su=stamped-update `stamped-update`[now.bowl our.bowl data.su])
    =/  =document
      :*  doc-type=doc-type.u.src
          title=new-title
          created=now.bowl
          modified=now.bowl
          parent=parent.u.src
          acl=*(map @p role)
          updates=copied-updates
          snapshot=snapshot.u.src
          versions=~
          comments=*(map @uv comment)
          trashed=~
      ==
    =/  pkey=doc-id  ?~(parent.u.src 0v0 u.parent.u.src)
    =/  siblings  (~(gut by children) pkey *(set doc-id))
    =.  docs      (~(put by docs) did document)
    =.  children  (~(put by children) pkey (~(put in siblings) did))
    =?  blobs  ?=(^ (~(get by blobs) doc-id.action))
      (~(put by blobs) did (~(got by blobs) doc-id.action))
    =?  thumbs  ?=(^ (~(get by thumbs) doc-id.action))
      (~(put by thumbs) did (~(got by thumbs) doc-id.action))
    `state
    ::
      %save-version
    =/  doc  (~(get by docs) doc-id.action)
    ?~  doc  `state
    =/  ver=version
      [now.bowl our.bowl *(set @p) `label.action blob.action]
    `state(docs (~(put by docs) doc-id.action (push-version u.doc ver)))
    ::
      %bulk-delete
    =|  cards=(list card)
    |-  ^-  (quip card _state)
    ?~  docs.action  [cards state]
    =^  c1  state  (do-soft-delete i.docs.action)
    $(docs.action t.docs.action, cards (weld cards c1))
    ::
      %bulk-restore
    =|  cards=(list card)
    |-  ^-  (quip card _state)
    ?~  docs.action  [cards state]
    =^  c1  state  (do-restore i.docs.action)
    $(docs.action t.docs.action, cards (weld cards c1))
    ::
      %bulk-purge
    =|  cards=(list card)
    |-  ^-  (quip card _state)
    ?~  docs.action  [cards state]
    =^  c1  state  (do-purge i.docs.action)
    $(docs.action t.docs.action, cards (weld cards c1))
    ::
      %bulk-move
    =|  cards=(list card)
    |-  ^-  (quip card _state)
    ?~  docs.action  [cards state]
    =/  doc  (~(get by docs) i.docs.action)
    ?~  doc  $(docs.action t.docs.action)
    =/  old-pkey=doc-id  ?~(parent.u.doc 0v0 u.parent.u.doc)
    =/  new-pkey=doc-id  ?~(new-parent.action 0v0 u.new-parent.action)
    =/  old-sibs  (~(gut by children) old-pkey *(set doc-id))
    =/  new-sibs  (~(gut by children) new-pkey *(set doc-id))
    =/  doc2  u.doc(parent new-parent.action, modified now.bowl)
    =.  state
      %=  state
        docs      (~(put by docs) i.docs.action doc2)
        children
          %+  ~(put by (~(put by children) old-pkey (~(del in old-sibs) i.docs.action)))
            new-pkey
          (~(put in new-sibs) i.docs.action)
      ==
    $(docs.action t.docs.action, cards cards)
    ::
      %share
    =/  doc  (~(get by docs) doc-id.action)
    ?~  doc  `state
    =/  doc2
      u.doc(acl (~(put by acl.u.doc) who.action role.action))
    =.  state  state(docs (~(put by docs) doc-id.action doc2))
    ::  Announce the new/changed role. The fact carries `who` so connected
    ::  peers only apply it to themselves.
    =^  fan  state
      (fanout-fact doc-id.action %role-change who.action role.action)
    ::  Push an invite so the doc shows up in the recipient's
    ::  Shared-with-me without any out-of-band URL. Nacks are ignored —
    ::  the ACL entry stands regardless (they may not have the app yet).
    =/  notice-cards=(list card)
      ?:  =(who.action our.bowl)  ~
      :~  :*  %pass  /share-notice/(scot %uv doc-id.action)
              %agent  [who.action %drive]
              %poke  %drive-share-notice
              !>(`share-notice`[doc-id.action title.u.doc doc-type.u.doc role.action])
          ==
      ==
    [(weld fan notice-cards) state]
    ::
      %revoke
    =/  doc  (~(get by docs) doc-id.action)
    ?~  doc  `state
    =/  doc2
      u.doc(acl (~(del by acl.u.doc) who.action))
    =.  state  state(docs (~(put by docs) doc-id.action doc2))
    ::  Kick ONLY the target's subscription; their agent's resubscribe will
    ::  crash on the ACL check (negative watch-ack) and clean up its mirror.
    ::  (A path-wide %revoked fact here used to nuke every OTHER
    ::  collaborator's mirror — and the owner's own editor.)
    =/  kick-card=card
      [%give %kick ~[/doc/(scot %uv doc-id.action)] `who.action]
    =/  retract-cards=(list card)
      ?:  =(who.action our.bowl)  ~
      :~  :*  %pass  /share-retract/(scot %uv doc-id.action)
              %agent  [who.action %drive]
              %poke  %drive-share-retract
              !>(`share-retract`[doc-id.action])
          ==
      ==
    [[kick-card retract-cards] state]
    ::
      %mint-token
    =/  doc  (~(get by docs) doc-id.action)
    ?~  doc  `state
    =/  tok  fresh-token
    =/  grant=token-grant  [doc-id.action role.action now.bowl |]
    `state(tokens (~(put by tokens) tok grant))
    ::
      %revoke-token
    ::  Mark the token as revoked, then close exactly the sessions minted
    ::  from it (from-token back-link, v8+). Sessions carrying the 0v0
    ::  legacy sentinel: fall back to the per-doc sweep.
    =/  grant  (~(get by tokens) token.action)
    ?~  grant  `state
    =.  state  state(tokens (~(put by tokens) token.action u.grant(revoked &)))
    =/  did=doc-id  doc-id.u.grant
    =/  bad-sids=(set @uv)
      %-  silt
      %+  murn  ~(tap by sessions)
      |=  [sid=@uv sess=token-session]
      ^-  (unit @uv)
      ?:  =(from-token.sess token.action)  `sid
      ?:  &(=(from-token.sess 0v0) =(doc-id.sess did))  `sid
      ~
    (kill-sessions bad-sids)
    ::
      %subscribe-remote
    =/  =mirror
      :*  owner=owner.action
          doc-type=%text
          title=''
          role=%viewer
          cached=[seq=0 blob=*octs]
          tail=*(list octs)
          next-seq=0
          pending=~
          comments=*(map @uv comment)
      ==
    :_  state(mirrors (~(put by mirrors) doc-id.action mirror))
    :~  :*  %pass  /mirror/(scot %uv doc-id.action)
            %agent  [owner.action %drive]
            %watch  /doc/(scot %uv doc-id.action)
        ==
    ==
    ::
      %unsubscribe-remote
    =/  m  (~(get by mirrors) doc-id.action)
    ?~  m  `state
    :_  state(mirrors (~(del by mirrors) doc-id.action))
    :~  :*  %pass  /mirror/(scot %uv doc-id.action)
            %agent  [owner.u.m %drive]
            %leave  ~
        ==
    ==
    ::
      %submit-update
    =/  doc  (~(get by docs) doc-id.action)
    ?^  doc
      =/  doc2  (append-update u.doc our.bowl update.action)
      =.  state  state(docs (~(put by docs) doc-id.action doc2))
      =^  fan  state  (fanout-fact doc-id.action %update update.action)
      ?.  (doc-needs-compaction doc2)
        [fan state]
      =^  fan2  state  (fanout-fact doc-id.action %request-snapshot ~)
      [(weld fan fan2) state]
    =/  m  (~(get by mirrors) doc-id.action)
    ?~  m  `state
    ::  Outbox: remember the edit until the owner acks it. A nack retries
    ::  with backoff, then surfaces %save-failed to the local browser.
    =/  seq  next-seq.u.m
    =/  m2
      %=  u.m
        next-seq  +(seq)
        pending   [[seq 0 update.action] pending.u.m]
      ==
    :_  state(mirrors (~(put by mirrors) doc-id.action m2))
    ~[(forward-update-card doc-id.action owner.u.m seq update.action)]
    ::
      %submit-awareness
    =/  doc  (~(get by docs) doc-id.action)
    ?^  doc
      (fanout-fact doc-id.action %awareness our.bowl blob.action)
    =/  m  (~(get by mirrors) doc-id.action)
    ?~  m  `state
    ::  Distinct wire from /forward/<did>/<seq>: awareness is lossy by
    ::  design, so its acks/nacks are ignored rather than retried.
    :_  state
    :~  :*  %pass
            /forward-awareness/(scot %uv doc-id.action)
            %agent  [owner.u.m %drive]
            %poke   %drive-awareness-poke
            !>([doc-id.action our.bowl blob.action])
        ==
    ==
    ::
      %submit-snapshot
    =/  doc  (~(get by docs) doc-id.action)
    ?~  doc  `state
    =/  doc2  (apply-snapshot u.doc our.bowl gen.action covered.action blob.action)
    `state(docs (~(put by docs) doc-id.action doc2))
    ::
      %add-comment
    =/  doc  (~(get by docs) doc-id.action)
    ?^  doc
      ?.  (check-role doc-id.action u.doc src.bowl %commenter)  `state
      =/  cmt=comment  [src.bowl text.action anchor.action now.bowl |]
      =/  doc2  u.doc(comments (~(put by comments.u.doc) comment-id.action cmt))
      =.  state  state(docs (~(put by docs) doc-id.action doc2))
      (fanout-fact doc-id.action %comment-add comment-id.action cmt)
    ::  Commenting on a mirror: forward to the owner, who validates and
    ::  fans the comment back to everyone (including us).
    (forward-comment doc-id.action comment-id.action %add text.action anchor.action)
    ::
      %resolve-comment
    =/  doc  (~(get by docs) doc-id.action)
    ?^  doc
      ?.  (check-role doc-id.action u.doc src.bowl %commenter)  `state
      =/  ex  (~(get by comments.u.doc) comment-id.action)
      ?~  ex  `state
      =/  cmt2=comment  u.ex(resolved &)
      =/  doc2  u.doc(comments (~(put by comments.u.doc) comment-id.action cmt2))
      =.  state  state(docs (~(put by docs) doc-id.action doc2))
      (fanout-fact doc-id.action %comment-resolved comment-id.action)
    (forward-comment doc-id.action comment-id.action %resolve ~)
    ::
      %delete-comment
    =/  doc  (~(get by docs) doc-id.action)
    ?^  doc
      =/  ex  (~(get by comments.u.doc) comment-id.action)
      ?~  ex  `state
      ::  Only the comment author or the doc owner can delete.
      ?.  ?|(=(author.u.ex src.bowl) =(src.bowl our.bowl))  `state
      =/  doc2  u.doc(comments (~(del by comments.u.doc) comment-id.action))
      =.  state  state(docs (~(put by docs) doc-id.action doc2))
      (fanout-fact doc-id.action %comment-deleted comment-id.action)
    (forward-comment doc-id.action comment-id.action %delete ~)
    ::
    ::  ===  Shared spaces  ===================================
    ::
      %create-space
    =/  sid=space-id  fresh-space-id
    =/  =space
      :*  name=name.action
          host=our.bowl
          members=(malt ~[[our.bowl %owner]])
          created=now.bowl
      ==
    :-  ~
    state(spaces (~(put by spaces) sid space))
    ::
      %rename-space
    =/  spc  (~(get by spaces) space-id.action)
    ?~  spc  `state
    ?.  (space-manager space-id.action src.bowl)  `state
    :-  ~
    state(spaces (~(put by spaces) space-id.action u.spc(name name.action)))
    ::
      %delete-space
    =/  spc  (~(get by spaces) space-id.action)
    ?~  spc  `state
    ::  only a %owner member may delete the space
    ?.  =(`space-role`%owner (fall (~(get by members.u.spc) src.bowl) %viewer))
      `state
    ::  Sever every member's open /doc streams BEFORE detaching the docs (a
    ::  /space kick alone doesn't close content subscriptions). Computed now
    ::  while docs-in-space still resolves.
    =/  doc-kicks=(list card)
      %-  zing
      %+  turn  ~(tap in ~(key by members.u.spc))
      |=  who=@p
      (kick-from-space-docs space-id.action who)
    ::  detach every doc that belonged to it (they become personal)
    =/  freed=(map doc-id space-id)
      %-  malt
      %+  skip  ~(tap by doc-space)
      |=([* s=space-id] =(s space-id.action))
    =.  state
      %=  state
        spaces     (~(del by spaces) space-id.action)
        doc-space  freed
      ==
    ::  tell every member ship the space is gone, then close the channels.
    :_  state
    %+  weld  doc-kicks
    :~  (give-space-fact space-id.action %space-kicked ~)
        [%give %kick ~[/space/(scot %uv space-id.action)] ~]
    ==
    ::
      %add-member
    =/  spc  (~(get by spaces) space-id.action)
    ?~  spc  `state
    ?.  (space-manager space-id.action src.bowl)  `state
    =/  spc2=space
      u.spc(members (~(put by members.u.spc) who.action space-role.action))
    =.  state  state(spaces (~(put by spaces) space-id.action spc2))
    :_  state
    ~[(give-space-fact space-id.action %space-roster members.spc2)]
    ::
      %remove-member
    =/  spc  (~(get by spaces) space-id.action)
    ?~  spc  `state
    ?.  (space-manager space-id.action src.bowl)  `state
    ::  never remove the last owner (that would orphan the space)
    =/  owners  (skim ~(val by members.u.spc) |=(r=space-role =(%owner r)))
    ?:  ?&(=(`space-role`%owner (fall (~(get by members.u.spc) who.action) %viewer)) =(1 (lent owners)))
      `state
    =/  spc2=space
      u.spc(members (~(del by members.u.spc) who.action))
    =.  state  state(spaces (~(put by spaces) space-id.action spc2))
    ::  fan the new roster to remaining members; kick the removed member off
    ::  the /space channel AND off every /doc stream (their client re-watches,
    ::  is nacked, and cleanly revokes — a /space kick alone doesn't sever
    ::  content subscriptions already open on the space's docs).
    :_  state
    %+  weld  (kick-from-space-docs space-id.action who.action)
    :~  (give-space-fact space-id.action %space-roster members.spc2)
        [%give %kick ~[/space/(scot %uv space-id.action)] `who.action]
    ==
    ::
      %set-member-role
    =/  spc  (~(get by spaces) space-id.action)
    ?~  spc  `state
    ?.  (space-manager space-id.action src.bowl)  `state
    ::  never demote the last owner — that orphans management (no owner can
    ::  delete or manage the space afterward). Same invariant remove-member
    ::  protects.
    =/  owners  (skim ~(val by members.u.spc) |=(r=space-role =(%owner r)))
    ?:  ?&  =(`space-role`%owner (fall (~(get by members.u.spc) who.action) %viewer))
            !=(%owner space-role.action)
            =(1 (lent owners))
        ==
      `state
    =/  spc2=space
      u.spc(members (~(put by members.u.spc) who.action space-role.action))
    =.  state  state(spaces (~(put by spaces) space-id.action spc2))
    :_  state
    ~[(give-space-fact space-id.action %space-roster members.spc2)]
    ::
      %set-doc-space
    =/  doc  (~(get by docs) doc-id.action)
    ?~  doc  `state
    =/  old-space  (~(get by doc-space) doc-id.action)
    =/  gone-cards=(list card)
      ?~  old-space  ~
      ~[(give-space-fact u.old-space %space-doc-gone doc-id.action)]
    ?~  space.action
      ::  → personal: announce removal to the old space's members.
      :_  state(doc-space (~(del by doc-space) doc-id.action))
      gone-cards
    ::  → a space: it must exist; announce the doc to that space's members.
    =/  spc  (~(get by spaces) u.space.action)
    ?~  spc  `state
    =/  sd=space-doc  [title.u.doc doc-type.u.doc modified.u.doc]
    =/  add-card  (give-space-fact u.space.action %space-doc doc-id.action sd)
    :_  state(doc-space (~(put by doc-space) doc-id.action u.space.action))
    ?:  =([~ u.space.action] old-space)  ~[add-card]  ::  reassign to same
    (weld gone-cards ~[add-card])
    ::
      %join-space
    =/  sid  space-id.action
    =/  sm=space-mirror  [host.action '' %viewer ~ ~]
    :_  state(space-mirrors (~(put by space-mirrors) sid sm))
    :~  :*  %pass  /space-mirror/(scot %uv sid)
            %agent  [host.action %drive]
            %watch  /space/(scot %uv sid)
        ==
    ==
    ::
      %leave-space
    =/  sm  (~(get by space-mirrors) space-id.action)
    ?~  sm  `state
    :_  state(space-mirrors (~(del by space-mirrors) space-id.action))
    :~  :*  %pass  /space-mirror/(scot %uv space-id.action)
            %agent  [host.u.sm %drive]
            %leave  ~
        ==
        ::  Relinquish membership on the host too — otherwise we stay in its
        ::  roster and keep doc access. The host un-rosters `src` and revokes.
        :*  %pass  /space-decline/(scot %uv space-id.action)
            %agent  [host.u.sm %drive]
            %poke  %drive-space-invite-decline
            !>(`space-invite-decline`[space-id.action])
        ==
    ==
    ::
      %invite-to-space
    ::  Host adds the ship to the roster (granting access now) and pokes it
    ::  with an invite notice so it appears in their invites inbox.
    =/  spc  (~(get by spaces) space-id.action)
    ?~  spc  `state
    ?.  (space-manager space-id.action src.bowl)  `state
    =/  spc2=space
      u.spc(members (~(put by members.u.spc) who.action space-role.action))
    =.  state  state(spaces (~(put by spaces) space-id.action spc2))
    :_  state
    :~  :*  %pass  /space-invite/(scot %uv space-id.action)
            %agent  [who.action %drive]
            %poke  %drive-space-invite-notice
            !>(`space-invite-notice`[space-id.action name.u.spc space-role.action])
        ==
        (give-space-fact space-id.action %space-roster members.spc2)
    ==
    ::
      %accept-space-invite
    ::  Recipient clears the pending invite and subscribes to the host.
    =/  inv  (~(get by space-invites) space-id.action)
    ?~  inv  `state
    =.  state  state(space-invites (~(del by space-invites) space-id.action))
    =/  sm=space-mirror  [host.u.inv name.u.inv space-role.u.inv ~ ~]
    :_  state(space-mirrors (~(put by space-mirrors) space-id.action sm))
    :~  :*  %pass  /space-mirror/(scot %uv space-id.action)
            %agent  [host.u.inv %drive]
            %watch  /space/(scot %uv space-id.action)
        ==
    ==
    ::
      %decline-space-invite
    ::  Recipient drops the pending invite and asks the host to un-roster them.
    =/  inv  (~(get by space-invites) space-id.action)
    ?~  inv  `state
    =.  state  state(space-invites (~(del by space-invites) space-id.action))
    :_  state
    :~  :*  %pass  /space-decline/(scot %uv space-id.action)
            %agent  [host.u.inv %drive]
            %poke  %drive-space-invite-decline
            !>(`space-invite-decline`[space-id.action])
        ==
    ==
    ::
      %post-message
    ::  A room we host → write + fan directly. A room we joined → ask the host
    ::  to post; the fan comes back to us over our /space subscription.
    ?:  (~(has by spaces) space.action)
      (host-post-message space.action src.bowl text.action)
    ?.  (~(has by space-mirrors) space.action)  `state
    :_  state
    :~  :*  %pass  /space-chat/(scot %uv space.action)
            %agent  [host:(~(got by space-mirrors) space.action) %drive]
            %poke  %drive-space-chat-poke
            !>(`space-chat-poke`[space.action %post text.action])
        ==
    ==
    ::
      %delete-message
    ?:  (~(has by spaces) space.action)
      (host-delete-message space.action msg-id.action src.bowl)
    ?.  (~(has by space-mirrors) space.action)  `state
    :_  state
    :~  :*  %pass  /space-chat/(scot %uv space.action)
            %agent  [host:(~(got by space-mirrors) space.action) %drive]
            %poke  %drive-space-chat-poke
            !>(`space-chat-poke`[space.action %delete msg-id.action])
        ==
    ==
    ::
      %read-space
    =.  state  state(space-read (~(put by space-read) space.action now.bowl))
    fanout-listing
    ::
      %send-dm
    =/  m=chat-msg  [fresh-msg-id our.bowl text.action now.bowl]
    =/  th  (fall (~(get by dms) who.action) *dm-thread)
    ::  our own send is already read; stamp read=now so it isn't "unread".
    =.  state
      %=  state
        dms  (~(put by dms) who.action th(msgs (push-msg msgs.th m), read now.bowl))
      ==
    =^  app  state  (push-app-event (dm-ping who.action))
    ?:  =(who.action our.bowl)  [app state]     ::  note-to-self: no wire poke
    =/  poke=card
      :*  %pass  /dm/(scot %p who.action)
          %agent  [who.action %drive]
          %poke  %drive-dm-poke
          !>(`dm-poke`[msg-id.m text.action at.m])
      ==
    [[poke app] state]
    ::
      %delete-dm
    ::  local-only: removes the message from our copy of the thread.
    =/  th  (~(get by dms) who.action)
    ?~  th  `state
    =/  msgs2  (skip msgs.u.th |=(m=chat-msg =(msg-id.m msg-id.action)))
    =.  state  state(dms (~(put by dms) who.action u.th(msgs msgs2)))
    (push-app-event (dm-ping who.action))
    ::
      %read-dm
    =/  th  (fall (~(get by dms) who.action) *dm-thread)
    =.  state  state(dms (~(put by dms) who.action th(read now.bowl)))
    fanout-listing
    ::
      %set-nickname
    =.  my-nickname  nick.action
    =.  nicknames  (~(put by nicknames) our.bowl nick.action)
    ::  tell every host of a space we've joined, and re-fan our own hosted
    ::  spaces, so all our co-members learn the new nickname.
    =/  host-pokes=(list card)
      %+  turn
        ~(tap in (silt (turn ~(val by space-mirrors) |=(sm=space-mirror host.sm))))
      |=  h=@p
      ^-  card
      :*  %pass  /set-nickname  %agent  [h %drive]
          %poke  %drive-set-nickname-poke  !>(`set-nickname-poke`[nick.action])
      ==
    =/  fan=(list card)
      %+  turn  ~(tap by spaces)
      |=  [sid=space-id *]
      ^-  card
      (give-space-fact sid [%space-nicknames (space-nicknames-for sid)])
    =^  feed  state  fanout-listing
    [:(weld host-pokes fan feed) state]
  ==
::
::  Forward a comment mutation from this (mirror) ship to the doc's owner.
++  forward-comment
  |=  [did=doc-id cid=comment-id act=$%([%add text=@t anchor=@t] [%resolve ~] [%delete ~])]
  ^-  (quip card _state)
  =/  m  (~(get by mirrors) did)
  ?~  m  `state
  :_  state
  :~  :*  %pass  /comment/(scot %uv did)/(scot %uv cid)
          %agent  [owner.u.m %drive]
          %poke  %drive-comment-poke
          !>(`comment-poke`[did cid act])
      ==
  ==
::
::  Owner side: validate and apply a comment mutation poked by a mirror
::  ship, then fan the result to all subscribers (including the sender).
++  recv-remote-comment
  |=  [src=@p =comment-poke]
  ^-  (quip card _state)
  =/  did  doc-id.comment-poke
  =/  cid  comment-id.comment-poke
  =/  act  act.comment-poke
  =/  doc  (~(get by docs) did)
  ?~  doc  ~|(%no-such-doc !!)
  ?-  -.act
      %add
    ?.  (check-role did u.doc src %commenter)  ~|(%not-commenter !!)
    =/  cmt=comment
      [src text.act anchor.act now.bowl |]
    =/  doc2  u.doc(comments (~(put by comments.u.doc) cid cmt))
    =.  state  state(docs (~(put by docs) did doc2))
    (fanout-fact did %comment-add cid cmt)
      %resolve
    ?.  (check-role did u.doc src %commenter)  ~|(%not-commenter !!)
    =/  ex  (~(get by comments.u.doc) cid)
    ?~  ex  `state
    =/  doc2  u.doc(comments (~(put by comments.u.doc) cid u.ex(resolved &)))
    =.  state  state(docs (~(put by docs) did doc2))
    (fanout-fact did %comment-resolved cid)
      %delete
    =/  ex  (~(get by comments.u.doc) cid)
    ?~  ex  `state
    ?.  ?|(=(author.u.ex src) =(src our.bowl))  ~|(%not-author !!)
    =/  doc2  u.doc(comments (~(del by comments.u.doc) cid))
    =.  state  state(docs (~(put by docs) did doc2))
    (fanout-fact did %comment-deleted cid)
  ==
::
::  Recipient side of share-notice/share-retract pokes. src.bowl IS the
::  owner by construction (it sent the poke); a malicious "share" merely
::  creates a listing entry whose open attempt fails the real ACL check.
++  recv-share-notice
  |=  [src=@p n=share-notice]
  ^-  (quip card _state)
  =/  inv=invite  [src title.n doc-type.n role.n now.bowl]
  =.  state  state(invites (~(put by invites) doc-id.n inv))
  fanout-listing
::
++  recv-share-retract
  |=  [src=@p r=share-retract]
  ^-  (quip card _state)
  =/  ex  (~(get by invites) doc-id.r)
  ?~  ex  `state
  ::  Only the owner that issued the invite may retract it.
  ?.  =(owner.u.ex src)  `state
  =.  state  state(invites (~(del by invites) doc-id.r))
  fanout-listing
::
::  Recipient side of a space invite. src is the host by construction.
++  recv-space-invite-notice
  |=  [src=@p n=space-invite-notice]
  ^-  (quip card _state)
  =/  inv=space-invite  [src space-id.n name.n space-role.n now.bowl]
  =.  state  state(space-invites (~(put by space-invites) space-id.n inv))
  fanout-listing
::
::  Host side: a recipient declined — drop just them from the roster and
::  close their (never-established) space subscription.
++  recv-space-invite-decline
  |=  [src=@p d=space-invite-decline]
  ^-  (quip card _state)
  =/  spc  (~(get by spaces) space-id.d)
  ?~  spc  `state
  ::  Sever their open /doc streams too (they may have opened space docs
  ::  before declining/leaving) — read the doc list before nothing changes it.
  =/  doc-kicks  (kick-from-space-docs space-id.d src)
  =/  spc2=space  u.spc(members (~(del by members.u.spc) src))
  =.  state  state(spaces (~(put by spaces) space-id.d spc2))
  :_  state
  %+  weld  doc-kicks
  :~  (give-space-fact space-id.d %space-roster members.spc2)
      [%give %kick ~[/space/(scot %uv space-id.d)] `src]
  ==
::  member → host: post to / delete from a room we host. Authorize against
::  membership (silently drop non-members); the host is the single writer.
::  a member told us (its host) its nickname; record it against the sender
::  (src, unspoofable) and re-fan every space we host that contains it.
++  recv-set-nickname
  |=  [src=@p p=set-nickname-poke]
  ^-  (quip card _state)
  =/  mine  (my-spaces-with-member src)
  ?~  mine  `state
  =.  nicknames  (~(put by nicknames) src nick.p)
  =^  feed  state  fanout-listing
  :_  state
  %+  weld  feed
  %+  turn  mine
  |=  sid=space-id
  (give-space-fact sid [%space-nicknames (space-nicknames-for sid)])
::  space-ids we host whose roster contains .who
++  my-spaces-with-member
  |=  who=@p
  ^-  (list space-id)
  %+  murn  ~(tap by spaces)
  |=  [sid=space-id spc=space]
  ?:((~(has by members.spc) who) `sid ~)
::  the nickname map restricted to a hosted space's roster
++  space-nicknames-for
  |=  sid=space-id
  ^-  (map @p @t)
  =/  spc  (~(get by spaces) sid)
  ?~  spc  ~
  %-  ~(gas by *(map @p @t))
  %+  murn  ~(tap in ~(key by members.u.spc))
  |=  who=@p
  ^-  (unit [@p @t])
  =/  n  (~(get by nicknames) who)
  ?~(n ~ `[who u.n])
++  recv-space-chat-poke
  |=  [src=@p p=space-chat-poke]
  ^-  (quip card _state)
  =/  spc  (~(get by spaces) space-id.p)
  ?~  spc  `state                              ::  we don't host this space
  ?~  (~(get by members.u.spc) src)  `state    ::  not a member — ignore
  ?-  -.act.p
      %post    (host-post-message space-id.p src text.act.p)
      %delete  (host-delete-message space-id.p msg-id.act.p src)
  ==
::  peer → us: a DM. Store it under the sender (author stamped = src, so it
::  can't be spoofed) and ping our browsers.
++  recv-dm-poke
  |=  [src=@p d=dm-poke]
  ^-  (quip card _state)
  =/  m=chat-msg  [msg-id.d src text.d at.d]
  =/  th  (fall (~(get by dms) src) *dm-thread)
  =.  state  state(dms (~(put by dms) src th(msgs (push-msg msgs.th m))))
  (push-app-event (dm-ping src))
::
::  =================================================================
::  Remote ship handlers
::  =================================================================
::
++  recv-remote-update
  |=  [src=@p =update-poke]
  ^-  (quip card _state)
  ::  Crash on unauthorized/unknown pokes: a crash nacks the sender, which
  ::  is the only honest signal. Silent acks made rejected edits look saved.
  =/  doc  (~(get by docs) doc-id.update-poke)
  ?~  doc  ~|(%no-such-doc !!)
  ?.  (check-role doc-id.update-poke u.doc src %editor)  ~|(%not-editor !!)
  ::  Crash on an over-cap remote update — a nack, not silent state bloat.
  ?:  (gth p.update.update-poke max-blob-bytes)  ~|(%update-too-large !!)
  =/  doc2  (append-update u.doc src update.update-poke)
  =.  state  state(docs (~(put by docs) doc-id.update-poke doc2))
  =^  fan  state  (fanout-fact doc-id.update-poke %update update.update-poke)
  ?.  (doc-needs-compaction doc2)
    [fan state]
  =^  fan2  state  (fanout-fact doc-id.update-poke %request-snapshot ~)
  [(weld fan fan2) state]
::
::  Build the editor→owner forwarding poke for one outbox entry. The wire
::  carries the outbox seq so acks/nacks can settle the exact entry.
++  forward-update-card
  |=  [did=doc-id owner=@p seq=@ud u=octs]
  ^-  card
  :*  %pass  /forward/(scot %uv did)/(scot %ud seq)
      %agent  [owner %drive]
      %poke  %drive-update-poke  !>(`update-poke`[did u])
  ==
::
++  recv-remote-awareness
  |=  [src=@p =awareness-poke]
  ^-  (quip card _state)
  =/  doc  (~(get by docs) doc-id.awareness-poke)
  ?~  doc  `state
  ?.  (check-role doc-id.awareness-poke u.doc src %viewer)  `state
  (fanout-fact doc-id.awareness-poke %awareness ship.awareness-poke blob.awareness-poke)
::
::  =================================================================
::  Subscription handlers
::  =================================================================
::
++  handle-watch-doc
  |=  [src=@p did=doc-id]
  ^-  (quip card _state)
  =/  doc  (~(get by docs) did)
  ?^  doc
    ::  Crash on unauthorized watch: a crash is a negative watch-ack, which
    ::  the subscriber's agent treats as revocation and cleans up. (A
    ::  positive-ack-then-kick caused an endless resubscribe loop instead.)
    ?.  (check-role did u.doc src %viewer)
      ~|(%no-access !!)
    =/  meta-fact=fact  [%meta title.u.doc modified.u.doc doc-type.u.doc]
    ::  Tell the subscriber its actual role up front (mirrors used to
    ::  assume %viewer until some later role-change).
    =/  role-fact=fact
      [%role-change src (fall (ship-role did u.doc src) %viewer)]
    =/  snap-fact=fact
      [%snapshot seq=seq.snapshot.u.doc blob=blob.snapshot.u.doc]
    =/  update-cards=(list card)
      %+  turn  (flop updates.u.doc)
      |=  su=stamped-update
      ^-  card
      [%give %fact ~ %drive-fact !>(`fact`[%update data.su])]
    ::  Replay existing comments so a fresh mirror gets history.
    =/  comment-cards=(list card)
      %+  turn  ~(tap by comments.u.doc)
      |=  [cid=@uv c=comment]
      ^-  card
      [%give %fact ~ %drive-fact !>(`fact`[%comment-add cid c])]
    ::  File/image bytes ride the initial burst only — never the SSE path.
    =/  blob-cards=(list card)
      =/  b  (~(get by blobs) did)
      ?~  b  ~
      =/  data=octs  [size.u.b bytes.u.b]
      ~[[%give %fact ~ %drive-fact !>(`fact`[%blob mime.u.b data])]]
    ::  A subscriber arriving at a doc with a deep update backlog is asked
    ::  to compact it — this is the recovery path for docs whose backlog
    ::  crossed the threshold while no client was connected.
    =/  compaction-cards=(list card)
      ?.  (doc-needs-compaction u.doc)  ~
      ~[[%give %fact ~ %drive-fact !>(`fact`[%request-snapshot ~])]]
    =/  cards=(list card)
      ;:  weld
        ~[[%give %fact ~ %drive-fact !>(meta-fact)]]
        ~[[%give %fact ~ %drive-fact !>(role-fact)]]
        ~[[%give %fact ~ %drive-fact !>(snap-fact)]]
        update-cards
        comment-cards
        blob-cards
        compaction-cards
      ==
    [cards state]
  =/  mr  (~(get by mirrors) did)
  ?~  mr
    =/  k=card  [%give %kick ~[/doc/(scot %uv did)] `src]
    [~[k] state]
  =/  meta-fact=fact  [%meta title.u.mr modified=now.bowl doc-type.u.mr]
  =/  snap-fact=fact  [%snapshot seq=seq.cached.u.mr blob=blob.cached.u.mr]
  =/  tail-cards=(list card)
    %+  turn  (flop tail.u.mr)
    |=  u=octs
    ^-  card
    [%give %fact ~ %drive-fact !>(`fact`[%update u])]
  :_  state
  ;:  weld
    ~[[%give %fact ~ %drive-fact !>(meta-fact)]]
    ~[[%give %fact ~ %drive-fact !>(snap-fact)]]
    tail-cards
  ==
::
++  handle-leave-doc
  |=  [src=@p did=doc-id]
  ^-  (quip card _state)
  =/  doc  (~(get by docs) did)
  ?^  doc
    ::  gall tracks watchers in sup.bowl; nothing to clean up locally.
    `state
  ?.  (has-local-watchers did)
    =/  m  (~(get by mirrors) did)
    ?~  m  `state
    :_  state(mirrors (~(del by mirrors) did))
    :~  :*  %pass  /mirror/(scot %uv did)
            %agent  [owner.u.m %drive]
            %leave  ~
        ==
    ==
  `state
::
::  =================================================================
::  Space channel — host side
::  =================================================================
::
::  the live docs currently assigned to a space, as space-doc summaries.
++  docs-in-space
  |=  sid=space-id
  ^-  (list [doc-id space-doc])
  %+  murn  ~(tap by doc-space)
  |=  [did=doc-id s=space-id]
  ^-  (unit [doc-id space-doc])
  ?.  =(s sid)  ~
  =/  doc  (~(get by docs) did)
  ?~  doc  ~
  ?^  trashed.u.doc  ~
  `[did title.u.doc doc-type.u.doc modified.u.doc]
::
::  emit a space-channel fact to every ship subscribed on /space/<sid>.
++  give-space-fact
  |=  [sid=space-id =fact]
  ^-  card
  [%give %fact ~[/space/(scot %uv sid)] %drive-fact !>(fact)]
::  If a doc belongs to a space, tell that space's members its metadata
::  changed (title/type/modified) so their doc list stays fresh. ~ otherwise.
++  space-doc-refresh
  |=  did=doc-id
  ^-  (list card)
  =/  sid  (~(get by doc-space) did)
  ?~  sid  ~
  =/  doc  (~(get by docs) did)
  ?~  doc  ~
  ~[(give-space-fact u.sid %space-doc did title.u.doc doc-type.u.doc modified.u.doc)]
::  If a doc belonged to a space, tell that space's members it's gone (call
::  BEFORE clearing its doc-space entry). ~ if it wasn't in a space.
++  space-doc-drop
  |=  did=doc-id
  ^-  (list card)
  =/  sid  (~(get by doc-space) did)
  ?~  sid  ~
  ~[(give-space-fact u.sid %space-doc-gone did)]
::  Kick `who` off every /doc subscription of a space's docs: their client
::  re-watches, is nacked (no longer authorized), and cleanly drops the
::  mirror + shows "access revoked". Closes the open-stream leak that a bare
::  /space kick misses.
++  kick-from-space-docs
  |=  [sid=space-id who=@p]
  ^-  (list card)
  %+  turn  (docs-in-space sid)
  |=  [did=doc-id *]
  ^-  card
  [%give %kick ~[/doc/(scot %uv did)] `who]
::
::  =================================================================
::  Chat helpers — per-space rooms + 1:1 DMs
::  =================================================================
::
::  cap on stored messages per room / thread; logs are newest-first, so the
::  oldest fall off the tail past the cap.
++  chat-cap  ^-  @ud  500
++  fresh-msg-id
  ^-  msg-id
  `@uv`(shaz (mix (mix eny.bowl `@`now.bowl) 'msg'))
::  prepend a message to a newest-first log, capped.
++  push-msg
  |=  [log=(list chat-msg) m=chat-msg]
  ^-  (list chat-msg)
  (scag chat-cap `(list chat-msg)`[m log])
::  one message as JSON (shared by the room + DM scries).
++  chat-msg-json
  |=  m=chat-msg
  ^-  json
  =,  enjs:format
  %-  pairs
  :~  id+s+(scot %uv msg-id.m)
      author+s+(scot %p author.m)
      text+s+text.m
      at+(numb (da-to-millis at.m))
  ==
::  Queue a raw app-level (0v0 sentinel) SSE payload to every browser stream
::  and arm the deferred flush. Mirrors fanout-listing with an arbitrary body.
++  push-app-event
  |=  payload=@t
  ^-  (quip card _state)
  =/  new-events=(list pending-sse-event)
    %+  turn  (sse-clients-for 0v0)
    |=(eid=@ta `pending-sse-event`[eid payload])
  ?:  =(0 (lent new-events))  [~ state]
  =/  was-empty=?  =(0 (lent pending-sse))
  =.  state  state(pending-sse (weld pending-sse new-events))
  ?:  was-empty  [~[[%pass /sse-flush %arvo %b %wait now.bowl]] state]
  [~ state]
::  "something changed in this room / thread — re-scry it" pings. The client
::  refetches the panel + the listing (for unread badges) on receipt.
++  space-chat-ping
  |=  sid=space-id
  ^-  @t
  =,  enjs:format
  (json-to-string (pairs ~[type+s+'space-chat' space+s+(scot %uv sid)]))
++  dm-ping
  |=  who=@p
  ^-  @t
  =,  enjs:format
  (json-to-string (pairs ~[type+s+'dm' peer+s+(scot %p who)]))
::  unread = peer-authored messages newer than our last-read stamp.
++  space-unread
  |=  sid=space-id
  ^-  @ud
  =/  log  (fall (~(get by space-chat) sid) ~)
  =/  since  (fall (~(get by space-read) sid) *@da)
  %+  roll  log
  |=  [m=chat-msg acc=@ud]
  ?:  ?&((gth at.m since) ?!(=(author.m our.bowl)))  +(acc)  acc
++  dm-unread
  |=  th=dm-thread
  ^-  @ud
  %+  roll  msgs.th
  |=  [m=chat-msg acc=@ud]
  ?:  ?&((gth at.m read.th) ?!(=(author.m our.bowl)))  +(acc)  acc
::  Host-side: append a message to a room we host, fan it to every member
::  ship over /space/<sid>, and ping our own browsers.
++  host-post-message
  |=  [sid=space-id author=@p text=@t]
  ^-  (quip card _state)
  =/  m=chat-msg  [fresh-msg-id author text now.bowl]
  =/  log  (fall (~(get by space-chat) sid) ~)
  =.  state  state(space-chat (~(put by space-chat) sid (push-msg log m)))
  =^  app  state  (push-app-event (space-chat-ping sid))
  :_  state
  [(give-space-fact sid %space-chat-msg m) app]
::  Host-side: delete a message from a room we host (author or manager), fan.
++  host-delete-message
  |=  [sid=space-id mid=msg-id who=@p]
  ^-  (quip card _state)
  =/  log  (fall (~(get by space-chat) sid) ~)
  =/  hit  (skim log |=(m=chat-msg =(msg-id.m mid)))
  ?~  hit  `state
  ?.  ?|(=(author.i.hit who) (space-manager sid who))  `state
  =/  log2  (skip log |=(m=chat-msg =(msg-id.m mid)))
  =.  state  state(space-chat (~(put by space-chat) sid log2))
  =^  app  state  (push-app-event (space-chat-ping sid))
  :_  state
  [(give-space-fact sid %space-chat-del mid) app]
::
::  A member ship watches /space/<sid> to learn the space's roster role and
::  doc list. Authorize against membership (crash = negative watch-ack),
::  then burst the space meta + one %space-doc per live doc in the space.
++  handle-watch-space
  |=  [src=@p sid=space-id]
  ^-  (quip card _state)
  =/  spc  (~(get by spaces) sid)
  ?~  spc  ~|(%no-such-space !!)
  =/  mr  (~(get by members.u.spc) src)
  ?~  mr  ~|(%not-a-member !!)
  =/  meta-fact=fact  [%space-meta name.u.spc u.mr]
  =/  roster-fact=fact  [%space-roster members.u.spc]
  =/  chat-fact=fact  [%space-chat-log (fall (~(get by space-chat) sid) ~)]
  =/  nicks-fact=fact  [%space-nicknames (space-nicknames-for sid)]
  =/  doc-cards=(list card)
    %+  turn  (docs-in-space sid)
    |=  [did=doc-id sd=space-doc]
    ^-  card
    [%give %fact ~ %drive-fact !>(`fact`[%space-doc did sd])]
  :_  state
  :*  [%give %fact ~ %drive-fact !>(meta-fact)]
      [%give %fact ~ %drive-fact !>(roster-fact)]
      [%give %fact ~ %drive-fact !>(chat-fact)]
      [%give %fact ~ %drive-fact !>(nicks-fact)]
      doc-cards
  ==
::
::  =================================================================
::  Mirror upstream-fact handler
::  =================================================================
::
++  handle-mirror-fact
  |=  [did=doc-id =fact]
  ^-  (quip card _state)
  =/  m  (~(get by mirrors) did)
  ?~  m  `state
  =/  pax=path  /doc/(scot %uv did)
  ::  %space-* facts never arrive on a /doc mirror channel — ignore them.
  ?+  -.fact  `state
      %snapshot
    =/  m2  u.m(cached [seq.fact blob.fact], tail ~)
    =.  state  state(mirrors (~(put by mirrors) did m2))
    (fanout-fact did fact)
      %update
    =/  m2  u.m(tail [update.fact tail.u.m])
    =.  state  state(mirrors (~(put by mirrors) did m2))
    (fanout-fact did fact)
      %meta
    ::  Title AND doc-type: propagate both, so a mirrored sheet renders as a
    ::  sheet (not a text doc).
    =/  m2  u.m(title title.fact, doc-type doc-type.fact)
    =.  state  state(mirrors (~(put by mirrors) did m2))
    =^  fan  state  (fanout-fact did fact)
    =^  feed  state  fanout-listing
    [(weld fan feed) state]
      %role-change
    ::  Facts fan to the whole /doc path; only apply a role that's OURS.
    ?.  =(who.fact our.bowl)  `state
    =/  m2  u.m(role role.fact)
    =.  state  state(mirrors (~(put by mirrors) did m2))
    (fanout-fact did fact)
      %revoked
    =/  kick-card=card  [%give %kick ~[pax] ~]
    =^  fan-cards  state  (fanout-fact did fact)
    =.  state  state(mirrors (~(del by mirrors) did))
    =^  feed  state  fanout-listing
    [:(weld fan-cards ~[kick-card] feed) state]
      %request-snapshot
    (fanout-fact did fact)
      %awareness
    (fanout-fact did fact)
      %trashed
    ::  Mirror's owner soft-deleted the source doc — drop the mirror.
    =/  kick-card=card  [%give %kick ~[pax] ~]
    =^  fan-cards  state  (fanout-fact did fact)
    =.  state  state(mirrors (~(del by mirrors) did))
    =^  feed  state  fanout-listing
    [:(weld fan-cards ~[kick-card] feed) state]
      %blob
    ::  File/image bytes from the owner — store locally so /blob serves
    ::  them. Never re-fanned (SSE JSON-encoding megabytes is pathological;
    ::  the browser fetches /blob itself).
    `state(blobs (~(put by blobs) did [mime.fact q.data.fact p.data.fact]))
      %comment-add
    =/  m2  u.m(comments (~(put by comments.u.m) comment-id.fact comment.fact))
    =.  state  state(mirrors (~(put by mirrors) did m2))
    (fanout-fact did fact)
      %comment-resolved
    =/  c  (~(get by comments.u.m) comment-id.fact)
    ?~  c  `state
    =/  m2  u.m(comments (~(put by comments.u.m) comment-id.fact u.c(resolved &)))
    =.  state  state(mirrors (~(put by mirrors) did m2))
    (fanout-fact did fact)
      %comment-deleted
    =/  m2  u.m(comments (~(del by comments.u.m) comment-id.fact))
    =.  state  state(mirrors (~(put by mirrors) did m2))
    (fanout-fact did fact)
      %save-failed
    ::  Owner-side rejection notices originate locally, never upstream.
    `state
  ==
::
::  Member side: apply space-channel facts to a joined space-mirror, then
::  ping the listing feed so the local browser re-renders the space.
++  handle-space-mirror-fact
  |=  [sid=space-id =fact]
  ^-  (quip card _state)
  =/  sm  (~(get by space-mirrors) sid)
  ?~  sm  `state
  ?+  -.fact  `state
      %space-meta
    =/  sm2=space-mirror  u.sm(name name.fact, space-role space-role.fact)
    =^  feed  state  fanout-listing
    [feed state(space-mirrors (~(put by space-mirrors) sid sm2))]
      %space-doc
    =/  sm2=space-mirror
      u.sm(docs (~(put by docs.u.sm) doc-id.fact space-doc.fact))
    =^  feed  state  fanout-listing
    [feed state(space-mirrors (~(put by space-mirrors) sid sm2))]
      %space-doc-gone
    =/  sm2=space-mirror  u.sm(docs (~(del by docs.u.sm) doc-id.fact))
    =^  feed  state  fanout-listing
    [feed state(space-mirrors (~(put by space-mirrors) sid sm2))]
      %space-roster
    =/  sm2=space-mirror  u.sm(members members.fact)
    =^  feed  state  fanout-listing
    [feed state(space-mirrors (~(put by space-mirrors) sid sm2))]
      %space-nicknames
    =.  nicknames  (~(uni by nicknames) nicks.fact)
    =^  feed  state  fanout-listing
    [feed state]
      %space-kicked
    =^  feed  state  fanout-listing
    [feed state(space-mirrors (~(del by space-mirrors) sid))]
      %space-chat-log
    ::  full history burst from the host (on join / re-watch): replace ours.
    =.  state  state(space-chat (~(put by space-chat) sid msgs.fact))
    (push-app-event (space-chat-ping sid))
      %space-chat-msg
    =/  log  (fall (~(get by space-chat) sid) ~)
    =.  state
      state(space-chat (~(put by space-chat) sid (push-msg log chat-msg.fact)))
    (push-app-event (space-chat-ping sid))
      %space-chat-del
    =/  log  (fall (~(get by space-chat) sid) ~)
    =/  log2  (skip log |=(m=chat-msg =(msg-id.m msg-id.fact)))
    =.  state  state(space-chat (~(put by space-chat) sid log2))
    (push-app-event (space-chat-ping sid))
  ==
::
::  =================================================================
::  HTTP handler
::  =================================================================
::
++  handle-http
  |=  [eyre-id=@ta =inbound-request:eyre]
  ^-  (quip card _state)
  =/  ,request-line:server
    (parse-request-line:server url.request.inbound-request)
  =+  send=(cury response:schooner eyre-id)
  =/  hdrs=(map @t @t)  (malt header-list.request.inbound-request)
  =/  method=@t  method.request.inbound-request
  ::
  ?.  ?=([%drive *] site)
    [(send [404 ~ [%stock ~]]) state]
  ::
  =/  rest  t.site
  ::
  ::  static assets
  ::
  ?:  ?=([%app ~] rest)
    ?:  =(`%js ext)
      [(send [200 ~ [%text-javascript drive-js]]) state]
    ?:  =(`%css ext)
      [(send [200 ~ [%text-css drive-css]]) state]
    [(send [404 ~ [%plain "not found"]]) state]
  ::
  ::  SPA / token entry
  ::
  ?:  ?=(~ rest)
    [(send [200 ~ [%html drive-ui]]) state]
  ?:  ?=([%d *] rest)
    [(send [200 ~ [%html drive-ui]]) state]
  ?:  ?=([%files *] rest)
    [(send [200 ~ [%html drive-ui]]) state]
  ?:  ?=([%notes *] rest)
    [(send [200 ~ [%html drive-ui]]) state]
  ?:  ?=([%photos *] rest)
    [(send [200 ~ [%html drive-ui]]) state]
  ?:  ?=([%trash *] rest)
    [(send [200 ~ [%html drive-ui]]) state]
  ?:  ?=([%starred *] rest)
    [(send [200 ~ [%html drive-ui]]) state]
  ?:  ?=([%recent *] rest)
    [(send [200 ~ [%html drive-ui]]) state]
  ?:  ?=([%space *] rest)
    [(send [200 ~ [%html drive-ui]]) state]
  ?:  ?=([%messages *] rest)
    [(send [200 ~ [%html drive-ui]]) state]
  ?:  ?=([%dm *] rest)
    [(send [200 ~ [%html drive-ui]]) state]
  ?:  ?=([%t ~] rest)
    ::  Token URLs use a query param: /drive/t?k=<token>
    =/  pams=(map @t @t)  (malt args)
    =/  k  (~(get by pams) 'k')
    ?~  k
      [(send [404 ~ [%html not-found-html]]) state]
    =/  tok=@uv  (slav %uv u.k)
    =/  grant  (~(get by tokens) tok)
    ?~  grant
      [(send [404 ~ [%html not-found-html]]) state]
    ?:  revoked.u.grant
      [(send [404 ~ [%html not-found-html]]) state]
    =/  sid  fresh-session
    =/  sess=token-session
      [doc-id.u.grant role.u.grant (add now.bowl ~d7) tok]
    =/  cookie=@t
      %+  rap  3
      :~  'drive-session='  (scot %uv sid)
          '; Path=/drive; SameSite=Lax; Max-Age=604800'
      ==
    =/  redirect-url=@t
      %+  rap  3
      :~  '/drive/d/'  (scot %uv doc-id.u.grant)
          '?via=token'
      ==
    :_  state(sessions (~(put by sessions) sid sess))
    %+  give-simple-payload:app:server  eyre-id
    ^-  simple-payload:http
    :-  :-  302
        :~  'location'^redirect-url
            'set-cookie'^cookie
        ==
    ~
  ::
  ::  SSE
  ::
  ?:  ?=([%sse ~] rest)
    =/  pams=(map @t @t)  (malt args)
    ::  ?feed=listing — the whole-drive change feed (ship-authed only).
    ::  Registered under the 0v0 sentinel doc-id; fanout-listing pings it
    ::  after any listing-mutating action so views re-scry instead of
    ::  polling.
    ?:  =([~ 'listing'] (~(get by pams) 'feed'))
      ?.  authenticated.inbound-request
        [(send [401 ~ [%plain "auth required"]]) state]
      :_  state(sse-clients (~(put by sse-clients) eyre-id `sse-sub`[0v0 0v0]))
      (begin:schooner-stream eyre-id)
    =/  k  (~(get by pams) 'id')
    ?~  k
      [(send [400 ~ [%plain "missing id"]]) state]
    =/  did=doc-id  (slav %uv u.k)
    ::  Accept either ship auth or a valid token-session for this doc.
    =/  sid  (parse-session-cookie hdrs)
    =/  authed=?
      ?:  authenticated.inbound-request  &
      ?~  sid  |
      =/  sess  (~(get by sessions) u.sid)
      ?~  sess  |
      &(=(doc-id.u.sess did) (gth expires.u.sess now.bowl))
    ?.  authed
      [(send [401 ~ [%plain "auth required"]]) state]
    ::  Initial state is delivered via scry GET /~/scry/drive/doc/<id>/state.json
    ::  on the client side; here we only register the SSE stream for live deltas.
    =/  sub=sse-sub  [did ?~(sid 0v0 u.sid)]
    ::  If this doc's backlog is compaction-worthy, ask the newly-connected
    ::  client right away. A lone client pulls /state BEFORE registering
    ::  here, so registration is the only moment it's reliably listening.
    =/  doc  (~(get by docs) did)
    =/  needs-compaction=?  &(?=(^ doc) (doc-needs-compaction u.doc))
    =/  req-event=(list pending-sse-event)
      ?.  needs-compaction  ~
      ~[[eyre-id (json-to-string (fact-to-json [%request-snapshot ~]))]]
    =/  was-empty=?  =(0 (lent pending-sse))
    =/  alarm-cards=(list card)
      ?.  &(needs-compaction was-empty)  ~
      ~[[%pass /sse-flush %arvo %b %wait now.bowl]]
    :_  %=  state
          sse-clients  (~(put by sse-clients) eyre-id sub)
          pending-sse  (weld pending-sse req-event)
        ==
    (weld (begin:schooner-stream eyre-id) alarm-cards)
  ::
  ::  POST /action — generic action endpoint, ship-authed
  ::
  ?:  ?&(?=([%action ~] rest) =('POST' method))
    ?.  authenticated.inbound-request
      [(send [401 ~ [%plain "auth required"]]) state]
    ?~  body.request.inbound-request
      [(send [400 ~ [%plain "body required"]]) state]
    =/  jon  (de:json:html q.u.body.request.inbound-request)
    ?~  jon
      [(send [400 ~ [%plain "bad json"]]) state]
    =/  act  (dejs-action u.jon)
    ?:  (action-oversized act)
      [(send [413 ~ [%plain "update too large (20 MiB max)"]]) state]
    =^  cards  state  (handle-action-feed act)
    =/  ok-payload=json  (pairs:enjs:format ~[ok+b+&])
    [(weld cards (send [200 ~ [%json ok-payload]])) state]
  ::
  ::  POST /action with token auth — uses session cookie
  ::
  ?:  ?&(?=([%token-action ~] rest) =('POST' method))
    =/  sid  (parse-session-cookie hdrs)
    ?~  sid
      [(send [401 ~ [%plain "no session"]]) state]
    =/  sess  (~(get by sessions) u.sid)
    ?~  sess
      [(send [401 ~ [%plain "invalid session"]]) state]
    ?~  body.request.inbound-request
      [(send [400 ~ [%plain "body required"]]) state]
    =/  jon  (de:json:html q.u.body.request.inbound-request)
    ?~  jon
      [(send [400 ~ [%plain "bad json"]]) state]
    =/  act  (dejs-action u.jon)
    ::  enforce: token sessions can only act on their own doc
    =/  ok=?
      ?+  -.act  |
        %submit-update     &(=(doc-id.act doc-id.u.sess) (has-role role.u.sess %editor))
        %submit-awareness  =(doc-id.act doc-id.u.sess)
        %submit-snapshot   &(=(doc-id.act doc-id.u.sess) (has-role role.u.sess %editor))
      ==
    ?.  ok
      [(send [403 ~ [%plain "forbidden"]]) state]
    ?:  (action-oversized act)
      [(send [413 ~ [%plain "update too large (20 MiB max)"]]) state]
    =^  cards  state  (handle-action act)
    =/  ok-payload=json  (pairs:enjs:format ~[ok+b+&])
    [(weld cards (send [200 ~ [%json ok-payload]])) state]
  ::
  ::  (The client uses /action and /token-action exclusively.)
  ::
  ::  GET /api/list
  ::
  ?:  ?=([%api %list ~] rest)
    =/  sid  (parse-session-cookie hdrs)
    ?~  sid
      [(send [401 ~ [%plain "no session"]]) state]
    =/  sess  (~(get by sessions) u.sid)
    ?~  sess
      [(send [401 ~ [%plain "invalid session"]]) state]
    [(send [200 ~ [%json (enjs-token-listing u.sess)]]) state]
  ::
  ::  GET /api/debug — runtime stats (sse-clients count, pending-sse count, etc.)
  ::
  ?:  ?=([%api %debug ~] rest)
    =,  enjs:format
    =/  sse-list=json
      :-  %a
      %+  turn  ~(tap by sse-clients)
      |=  [eid=@ta sub=sse-sub]
      %-  pairs
      :~  eid+s+eid
          doc-id+s+(scot %uv doc-id.sub)
      ==
    =/  payload=json
      %-  pairs
      :~  sse-clients-count+(numb (lent ~(tap by sse-clients)))
          sse-clients+sse-list
          pending-sse+(numb (lent pending-sse))
          docs+(numb (lent ~(tap by docs)))
      ==
    [(send [200 ~ [%json payload]]) state]
  ::
  ::  GET /api/health — version + counts, for monitoring + smoke tests
  ::
  ?:  ?=([%api %health ~] rest)
    [(send [200 ~ [%json enjs-health]]) state]
  ::
  ::  GET /api/whoami
  ::
  ?:  ?=([%api %whoami ~] rest)
    =,  enjs:format
    =/  sid  (parse-session-cookie hdrs)
    =/  payload=json
      ?~  sid
        ?:  authenticated.inbound-request
          (pairs ship+s+(scot %p our.bowl) auth+s+'ship' ~)
        (pairs auth+s+'none' ~)
      =/  sess  (~(get by sessions) u.sid)
      ?~  sess
        ?:  authenticated.inbound-request
          (pairs ship+s+(scot %p our.bowl) auth+s+'ship' ~)
        (pairs auth+s+'none' ~)
      ::  Token session — include doc type if available.
      =/  doc  (~(get by docs) doc-id.u.sess)
      =/  doc-type-str=@t
        ?~  doc  'text'
        (scot %tas doc-type.u.doc)
      %-  pairs
      :~  ship+s+(scot %p our.bowl)
          auth+s+'token'
          doc+s+(scot %uv doc-id.u.sess)
          role+s+(scot %tas role.u.sess)
          type+s+doc-type-str
          title+s+?~(doc '' title.u.doc)
      ==
    [(send [200 ~ [%json payload]]) state]
  ::
  ::  GET /state?id=<doc-id> — returns the full doc state (snapshot + tail
  ::  of updates) as JSON for the frontend's initial load. Accepts either
  ::  ship auth or a valid token-session for the requested doc.
  ::
  ?:  ?=([%state ~] rest)
    =/  pams=(map @t @t)  (malt args)
    =/  k  (~(get by pams) 'id')
    ?~  k
      [(send [400 ~ [%plain "missing id"]]) state]
    =/  did=doc-id  (slav %uv u.k)
    ::  Auth: ship-authed users always pass; token-authed users only for their doc.
    =/  authed=?
      ?:  authenticated.inbound-request  &
      =/  sid  (parse-session-cookie hdrs)
      ?~  sid  |
      =/  sess  (~(get by sessions) u.sid)
      ?~  sess  |
      &(=(doc-id.u.sess did) (gth expires.u.sess now.bowl))
    ?.  authed
      [(send [401 ~ [%plain "auth required"]]) state]
    ::  Serving /state to a client over a compaction-worthy backlog is the
    ::  other moment to ask connected clients for a snapshot.
    =/  doc  (~(get by docs) did)
    =^  compaction-cards  state
      ?:  &(?=(^ doc) (doc-needs-compaction u.doc))
        (fanout-fact did %request-snapshot ~)
      [~ state]
    [(weld compaction-cards (send [200 ~ [%json (enjs-doc-state did)]])) state]
  ::
  ::  GET /version?id=<doc>&at=<unix-ms> — one checkpoint's full encoded
  ::  Y.Doc state. A dedicated route (like /state, /blob) rather than the
  ::  scry gateway: blobs are large binary and this is a capability read.
  ::
  ?:  ?=([%version ~] rest)
    =/  pams=(map @t @t)  (malt args)
    =/  k  (~(get by pams) 'id')
    =/  at-k  (~(get by pams) 'at')
    ::  Reject missing OR empty (`?at=`): rash+dem crashes on a non-digit
    ::  cord, so an empty value would 500 rather than 400 without this.
    ?:  ?|(?=(~ k) ?=(~ at-k) =('' u.k) =('' u.at-k))
      [(send [400 ~ [%plain "missing id or at"]]) state]
    =/  did=doc-id  (slav %uv u.k)
    ::  rash+dem, not slav %ud: query values are bare decimal digits, but
    ::  slav %ud demands dot-grouped @ud syntax (1.783.…) and crashes here.
    =/  at-ms=@ud  (rash u.at-k dem)
    =/  authed=?
      ?:  authenticated.inbound-request  &
      =/  sid  (parse-session-cookie hdrs)
      ?~  sid  |
      =/  sess  (~(get by sessions) u.sid)
      ?~  sess  |
      &(=(doc-id.u.sess did) (gth expires.u.sess now.bowl))
    ?.  authed
      [(send [401 ~ [%plain "auth required"]]) state]
    [(send [200 ~ [%json (enjs-version-blob did at-ms)]]) state]
  ::
  ::  POST /upload?title=...&parent=<id-or-empty> — body is the raw bytes;
  ::  mime taken from Content-Type. Creates %image doc if mime^starts 'image/',
  ::  otherwise %file. Stores bytes in `blobs` map.
  ::
  ?:  ?&(?=([%upload ~] rest) =('POST' method))
    ?.  authenticated.inbound-request
      [(send [401 ~ [%plain "auth required"]]) state]
    ?~  body.request.inbound-request
      [(send [400 ~ [%plain "body required"]]) state]
    ::  Loom-safety cap: blobs live in agent state and cross ames as one
    ::  fact; 20 MiB is generous for docs/photos and cheap to lift later.
    ?:  (gth p.u.body.request.inbound-request 20.971.520)
      [(send [413 ~ [%plain "file too large (20 MiB max)"]]) state]
    =/  pams=(map @t @t)  (malt args)
    =/  title=@t  (~(gut by pams) 'title' 'Untitled')
    =/  parent=(unit doc-id)
      =/  p  (~(get by pams) 'parent')
      ?~  p  ~
      ?:  =('' u.p)  ~
      `(slav %uv u.p)
    =/  mime=@t
      (fall (~(get by hdrs) 'content-type') 'application/octet-stream')
    =/  body-octs=octs  u.body.request.inbound-request
    =/  blob=@ux  `@ux`q.body-octs
    =/  did=doc-id  fresh-doc-id
    =/  is-image=?  =((end [3 6] mime) 'image/')
    =/  dt=doc-type  ?:(is-image %image %file)
    =/  =document
      :*  doc-type=dt
          title=title
          created=now.bowl
          modified=now.bowl
          parent=parent
          acl=*(map @p role)
          updates=*(list stamped-update)
          snapshot=[seq=0 blob=*octs]
          versions=~
          comments=*(map @uv comment)
          trashed=~
      ==
    =/  blob-rec=file-blob  [mime blob p.body-octs]
    =/  pkey=doc-id  ?~(parent 0v0 u.parent)
    =/  siblings  (~(gut by children) pkey *(set doc-id))
    =.  state
      %=    state
          docs      (~(put by docs) did document)
          blobs     (~(put by blobs) did blob-rec)
          children  (~(put by children) pkey (~(put in siblings) did))
      ==
    =^  feed-cards  state  fanout-listing
    :_  state
    %+  weld  feed-cards
    %+  give-simple-payload:app:server  eyre-id
    ^-  simple-payload:http
    :-  :-  200
        :~  'content-type'^'application/json'
        ==
    =/  body-text=@t
      (json-to-string (pairs:enjs:format ~[id+s+(scot %uv did)]))
    `(as-octs:mimes:html body-text)
  ::
  ::  GET /blob?id=<doc-id> — serve raw bytes (image or file)
  ::
  ?:  ?=([%blob ~] rest)
    =/  pams=(map @t @t)  (malt args)
    =/  k  (~(get by pams) 'id')
    ?~  k
      [(send [400 ~ [%plain "missing id"]]) state]
    =/  did=doc-id  (slav %uv u.k)
    ::  Auth: same policy as /state — ship-authed users always pass; token
    ::  sessions pass for the blob's own doc OR its parent doc (inline
    ::  images are separate %image docs parented under the doc that embeds
    ::  them, and a link viewer of that doc must be able to render them).
    =/  authed=?
      ?:  authenticated.inbound-request  &
      =/  sid  (parse-session-cookie hdrs)
      ?~  sid  |
      =/  sess  (~(get by sessions) u.sid)
      ?~  sess  |
      ?.  (gth expires.u.sess now.bowl)  |
      ?:  =(doc-id.u.sess did)  &
      =/  doc  (~(get by docs) did)
      ?~  doc  |
      ?~  parent.u.doc  |
      =(doc-id.u.sess u.parent.u.doc)
    ?.  authed
      [(send [401 ~ [%plain "auth required"]]) state]
    =/  blob  (~(get by blobs) did)
    ?~  blob
      [(send [404 ~ [%plain "no such blob"]]) state]
    :_  state
    %+  give-simple-payload:app:server  eyre-id
    ^-  simple-payload:http
    :-  :-  200
        :~  'content-type'^mime.u.blob
            'cache-control'^'private, max-age=86400'
        ==
    `[size.u.blob bytes.u.blob]
  ::
  ::  GET /thumb?id=<doc-id> — serve the client-generated image thumbnail
  ::  (small JPEG/PNG). Same auth as /blob. 404 when absent so the client
  ::  falls back to the full /blob.
  ::
  ?:  ?&(?=([%thumb ~] rest) =('GET' method))
    =/  pams=(map @t @t)  (malt args)
    =/  k  (~(get by pams) 'id')
    ?~  k
      [(send [400 ~ [%plain "missing id"]]) state]
    =/  did=doc-id  (slav %uv u.k)
    =/  authed=?
      ?:  authenticated.inbound-request  &
      =/  sid  (parse-session-cookie hdrs)
      ?~  sid  |
      =/  sess  (~(get by sessions) u.sid)
      ?~  sess  |
      ?.  (gth expires.u.sess now.bowl)  |
      ?:  =(doc-id.u.sess did)  &
      =/  doc  (~(get by docs) did)
      ?~  doc  |
      ?~  parent.u.doc  |
      =(doc-id.u.sess u.parent.u.doc)
    ?.  authed
      [(send [401 ~ [%plain "auth required"]]) state]
    =/  th  (~(get by thumbs) did)
    ?~  th
      [(send [404 ~ [%plain "no thumb"]]) state]
    :_  state
    %+  give-simple-payload:app:server  eyre-id
    ^-  simple-payload:http
    :-  :-  200
        :~  'content-type'^'image/jpeg'
            'cache-control'^'private, max-age=86400'
        ==
    `u.th
  ::
  ::  POST /thumb?id=<doc-id> — store a thumbnail (ship-authed). Body is the
  ::  raw thumbnail bytes. Capped small — a thumbnail should be a few KB.
  ::
  ?:  ?&(?=([%thumb ~] rest) =('POST' method))
    ?.  authenticated.inbound-request
      [(send [401 ~ [%plain "auth required"]]) state]
    =/  pams=(map @t @t)  (malt args)
    =/  k  (~(get by pams) 'id')
    ?~  k
      [(send [400 ~ [%plain "missing id"]]) state]
    ?~  body.request.inbound-request
      [(send [400 ~ [%plain "body required"]]) state]
    ?:  (gth p.u.body.request.inbound-request 262.144)
      [(send [413 ~ [%plain "thumb too large (256 KiB max)"]]) state]
    =/  did=doc-id  (slav %uv u.k)
    ::  Only store a thumb for a doc we actually own — no orphan storage.
    ?.  (~(has by docs) did)
      [(send [404 ~ [%plain "no such doc"]]) state]
    =/  =octs  u.body.request.inbound-request
    :_  state(thumbs (~(put by thumbs) did octs))
    %+  give-simple-payload:app:server  eyre-id
    ^-  simple-payload:http
    [[200 ~[content-type+'application/json']] `(as-octs:mimes:html '{"ok":true}')]
  ::
  ::  GET /manifest.json — PWA install manifest (inline, no auth needed).
  ::
  ?:  ?=([%manifest ~] rest)
    :_  state
    %+  give-simple-payload:app:server  eyre-id
    ^-  simple-payload:http
    [[200 ~[content-type+'application/manifest+json']] `(as-octs:mimes:html pwa-manifest)]
  ::
  ::  GET /sw.js — the service worker (offline shell caching).
  ::
  ?:  ?=([%sw ~] rest)
    :_  state
    %+  give-simple-payload:app:server  eyre-id
    ^-  simple-payload:http
    ::  Service-Worker-Allowed lets a /drive-scoped worker control /drive/*.
    [[200 :~('content-type'^'text/javascript' 'service-worker-allowed'^'/drive/')] `(as-octs:mimes:html drive-sw)]
  ::
  [(send [404 ~ [%plain "not found"]]) state]
::
::  =================================================================
::  Cookie / parse helpers
::  =================================================================
::
++  parse-session-cookie
  |=  hdrs=(map @t @t)
  ^-  (unit @uv)
  =/  cookie  (~(get by hdrs) 'cookie')
  ?~  cookie  ~
  =/  s=tape  (trip u.cookie)
  =/  needle=tape  "drive-session="
  =/  pos  (find needle s)
  ?~  pos  ~
  =/  rest=tape  (slag (add u.pos (lent needle)) s)
  =/  end-pos  (find ";" rest)
  =/  val=tape  ?~(end-pos rest (scag u.end-pos rest))
  ?~  val  ~
  `(slav %uv (crip val))
::
::  =================================================================
::  JSON listings
::  =================================================================
::
++  da-to-millis
  |=  =@da
  ^-  @ud
  =/  ms-per-sec=@dr  (div ~s1 1.000)
  ?:  (lth da ~1970.1.1)  0
  (div (sub da ~1970.1.1) ms-per-sec)
::
++  enjs-listing
  ^-  json
  =,  enjs:format
  =/  live-docs=(list [doc-id document])
    %+  skim  ~(tap by docs)
    |=([* d=document] ?=(~ trashed.d))
  =/  owned-sorted=(list [doc-id document])
    %+  sort  live-docs
    |=  [[* d1=document] [* d2=document]]
    (gth `@`modified.d1 `@`modified.d2)
  =/  owned=(list json)
    %+  turn  owned-sorted
    |=  [did=doc-id =document]
    ^-  json
    (doc-summary did document our.bowl %owner %.y)
  =/  mirrored=(list json)
    %+  turn  ~(tap by mirrors)
    |=  [did=doc-id =mirror]
    ^-  json
    %-  pairs
    :~  id+s+(scot %uv did)
        title+s+title.mirror
        type+s+(scot %tas doc-type.mirror)
        owner+s+(scot %p owner.mirror)
        role+s+(scot %tas role.mirror)
        parent+~
        starred+b+(~(has in starred) did)
    ==
  ::  Shared-with-me = owner-pushed invites, with live mirror data taking
  ::  precedence for title/type/role freshness when we've opened the doc.
  =/  shared=(list json)
    %+  turn
      %+  sort  ~(tap by invites)
      |=  [[* i1=invite] [* i2=invite]]
      (gth `@`at.i1 `@`at.i2)
    |=  [did=doc-id inv=invite]
    ^-  json
    =/  m  (~(get by mirrors) did)
    %-  pairs
    :~  id+s+(scot %uv did)
        title+s+?^(m ?:(=('' title.u.m) title.inv title.u.m) title.inv)
        type+s+(scot %tas ?^(m doc-type.u.m doc-type.inv))
        owner+s+(scot %p owner.inv)
        role+s+(scot %tas ?^(m role.u.m role.inv))
        parent+~
        starred+b+(~(has in starred) did)
    ==
  ::  Spaces for the switcher: those we host + those we've joined elsewhere.
  =/  hosted=(list json)
    %+  turn
      %+  sort  ~(tap by spaces)
      |=  [[* s1=space] [* s2=space]]
      (gth `@`created.s1 `@`created.s2)
    |=  [sid=space-id =space]
    ^-  json
    (space-summary sid space)
  =/  joined=(list json)
    %+  turn  ~(tap by space-mirrors)
    |=  [sid=space-id sm=space-mirror]
    ^-  json
    (space-mirror-summary sid sm)
  ::  Pending space invitations (host invited us; we haven't accepted yet).
  =/  invite-list=(list json)
    %+  turn
      %+  sort  ~(tap by space-invites)
      |=  [[* i1=space-invite] [* i2=space-invite]]
      (gth `@`at.i1 `@`at.i2)
    |=  [sid=space-id inv=space-invite]
    ^-  json
    %-  pairs
    :~  id+s+(scot %uv sid)
        name+s+name.inv
        host+s+(scot %p host.inv)
        role+s+(scot %tas space-role.inv)
    ==
  =/  dm-total=@ud
    %+  roll  ~(val by dms)
    |=  [th=dm-thread acc=@ud]
    (add acc (dm-unread th))
  %-  pairs
  :~  owned+a+owned
      shared+a+shared
      mirrored+a+mirrored
      spaces+a+(weld hosted joined)
      space-invites+a+invite-list
      dm-unread+(numb dm-total)
      my-nickname+s+my-nickname
      :-  %nicknames
      %-  pairs
      %+  turn  ~(tap by nicknames)
      |=  [who=@p n=@t]
      [(scot %p who) s+n]
  ==
::
::  enjs-trash-listing: just the trashed-docs view. Each entry includes
::  `trashed-at` (unix-ms) and `days-remaining` until 30-day auto-purge.
::
++  enjs-trash-listing
  ^-  json
  =,  enjs:format
  =/  trashed-docs=(list [doc-id document])
    %+  skim  ~(tap by docs)
    |=([* d=document] ?=(^ trashed.d))
  =/  sorted=(list [doc-id document])
    %+  sort  trashed-docs
    |=  [[* d1=document] [* d2=document]]
    =/  t1  ?~(trashed.d1 *@da u.trashed.d1)
    =/  t2  ?~(trashed.d2 *@da u.trashed.d2)
    (gth `@`t1 `@`t2)
  =/  items=(list json)
    %+  turn  sorted
    |=  [did=doc-id =document]
    ^-  json
    =/  ta=@da  ?~(trashed.document *@da u.trashed.document)
    =/  ttl-ms=@ud  (div (sub ~d30 (sub now.bowl ta)) (div ~s1 1.000))
    %-  pairs
    :~  id+s+(scot %uv did)
        title+s+title.document
        type+s+(scot %tas doc-type.document)
        parent+?~(parent.document ~ s+(scot %uv u.parent.document))
        trashed-at+(numb (da-to-millis ta))
        ttl-ms+(numb ttl-ms)
    ==
  (pairs ~[items+a+items])
::
++  pwa-manifest
  ^-  @t
  '''
  {"name":"Groundwire Drive","short_name":"Drive","start_url":"/drive","scope":"/drive/","display":"standalone","background_color":"#ffffff","theme_color":"#1a73e8"}
  '''
::
++  not-found-html
  ^-  @t
  '''
  <!DOCTYPE html><html lang="en"><head>
  <meta charset="utf-8"><title>Not found</title>
  <style>
    body { font-family: ui-serif, Georgia, serif; background: #fff; color: #1a1d23;
           display: grid; place-items: center; min-height: 100vh; margin: 0; }
    @media (prefers-color-scheme: dark) {
      body { background: #0f1115; color: #e6e8ec; }
    }
    .card { text-align: center; padding: 32px; }
    h1 { font-size: 56px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 8px; }
    p { color: #6b7280; font-size: 16px; }
  </style></head><body>
  <div class="card"><h1>404</h1><p>This link is no longer valid.</p></div>
  </body></html>
  '''
::
++  enjs-folder-contents
  |=  [pkey=doc-id]
  ^-  json
  =,  enjs:format
  =/  child-ids=(set doc-id)  (~(gut by children) pkey ~)
  =/  child-docs=(list [doc-id document])
    %+  murn  ~(tap in child-ids)
    |=  did=doc-id
    ^-  (unit [doc-id document])
    =/  d  (~(get by docs) did)
    ?~  d  ~
    ::  Skip trashed docs — they live in the dedicated trash view.
    ?^  trashed.u.d  ~
    `[did u.d]
  =/  sorted=(list [doc-id document])
    %+  sort  child-docs
    |=  [[* d1=document] [* d2=document]]
    ::  sort all by modified desc; no type grouping
    (gth `@`modified.d1 `@`modified.d2)
  %-  pairs
  :~  :-  'items'
      :-  %a
      %+  turn  sorted
      |=  [did=doc-id =document]
      ^-  json
      (doc-summary did document our.bowl %owner %.y)
  ==
::
::  show-acl: whether to include the doc's collaborator list. The listing
::  and doc-meta scries (ship-authed) set it; /drive/state does NOT, since a
::  link-token VIEWER can read /state and must not see the owner's ACL.
++  doc-summary
  |=  [did=doc-id =document owner=@p =role show-acl=?]
  ^-  json
  =,  enjs:format
  =/  parent-json=json
    ?~  parent.document  ~
    s+(scot %uv u.parent.document)
  =/  blob-info=json
    =/  b  (~(get by blobs) did)
    ?~  b  ~
    %-  pairs
    :~  mime+s+mime.u.b
        size+(numb size.u.b)
    ==
  =/  space-json=json
    =/  sid  (~(get by doc-space) did)
    ?~  sid  ~
    s+(scot %uv u.sid)
  =/  base=(list [@t json])
    :~  id+s+(scot %uv did)
        title+s+title.document
        type+s+(scot %tas doc-type.document)
        owner+s+(scot %p owner)
        role+s+(scot %tas role)
        modified+(numb (da-to-millis modified.document))
        created+(numb (da-to-millis created.document))
        parent+parent-json
        blob+blob-info
        starred+b+(~(has in starred) did)
        space+space-json
    ==
  %-  pairs
  ?.  show-acl  base
  (snoc base acl+(acl-to-json acl.document))
::
++  space-summary
  |=  [sid=space-id =space]
  ^-  json
  =,  enjs:format
  =/  my-role  (fall (~(get by members.space) our.bowl) %viewer)
  %-  pairs
  :~  id+s+(scot %uv sid)
      name+s+name.space
      host+s+(scot %p host.space)
      role+s+(scot %tas my-role)
      members+(numb ~(wyt by members.space))
      created+(numb (da-to-millis created.space))
      joined+b+|                               ::  we host this one
      unread+(numb (space-unread sid))
  ==
::
::  summary for a space we JOINED (hosted elsewhere). Roster isn't mirrored,
::  so member count is unknown (0); `joined` distinguishes it in the client.
++  space-mirror-summary
  |=  [sid=space-id sm=space-mirror]
  ^-  json
  =,  enjs:format
  %-  pairs
  :~  id+s+(scot %uv sid)
      name+s+name.sm
      host+s+(scot %p host.sm)
      role+s+(scot %tas space-role.sm)
      members+(numb 0)
      created+(numb 0)
      joined+b+&
      unread+(numb (space-unread sid))
  ==
::
::  the doc list for a JOINED space (hosted elsewhere), from its mirror, as
::  doc-summary-shaped rows. owner=host so the client subscribes upstream when
::  opening one. ~a when we haven't joined it.
++  enjs-space-docs
  |=  sid=space-id
  ^-  json
  =,  enjs:format
  =/  sm  (~(get by space-mirrors) sid)
  ?~  sm  a+~
  :-  %a
  %+  turn  ~(tap by docs.u.sm)
  |=  [did=doc-id sd=space-doc]
  ^-  json
  %-  pairs
  :~  id+s+(scot %uv did)
      title+s+title.sd
      type+s+(scot %tas doc-type.sd)
      owner+s+(scot %p host.u.sm)
      role+s+(scot %tas space-role.u.sm)
      modified+(numb (da-to-millis modified.sd))
      parent+~
      starred+b+(~(has in starred) did)
      space+s+(scot %uv sid)
  ==
::
::  full detail for one space: metadata + the member roster (for the
::  member-management surface). ~ when the space doesn't exist.
++  enjs-space
  |=  sid=space-id
  ^-  json
  =,  enjs:format
  =/  render-members
    |=  members=(map @p space-role)
    ^-  (list json)
    %+  turn  ~(tap by members)
    |=  [who=@p sr=space-role]
    ^-  json
    (pairs ~[who+s+(scot %p who) role+s+(scot %tas sr)])
  =/  spc  (~(get by spaces) sid)
  ?^  spc
    %-  pairs
    :~  id+s+(scot %uv sid)
        name+s+name.u.spc
        host+s+(scot %p host.u.spc)
        created+(numb (da-to-millis created.u.spc))
        members+a+(render-members members.u.spc)
    ==
  ::  a joined space: the roster is whatever the host propagated to the mirror
  =/  sm  (~(get by space-mirrors) sid)
  ?~  sm  ~
  %-  pairs
  :~  id+s+(scot %uv sid)
      name+s+name.u.sm
      host+s+(scot %p host.u.sm)
      created+(numb 0)
      members+a+(render-members members.u.sm)
  ==
::
::  recent messages in a space room (hosted or joined — both read the same
::  space-chat map). Oldest-first for the client, plus our last-read stamp.
++  enjs-chat
  |=  sid=space-id
  ^-  json
  =,  enjs:format
  =/  log  (flop (fall (~(get by space-chat) sid) ~))
  =/  read  (fall (~(get by space-read) sid) *@da)
  %-  pairs
  :~  read+(numb (da-to-millis read))
      messages+a+(turn log chat-msg-json)
  ==
::  DM inbox: one row per counterparty with the last message + unread count,
::  most-recently-active first.
++  enjs-dms
  ^-  json
  =,  enjs:format
  =/  sorted
    %+  sort  ~(tap by dms)
    |=  [[* a=dm-thread] [* b=dm-thread]]
    =/  la  ?~(msgs.a *@da at.i.msgs.a)
    =/  lb  ?~(msgs.b *@da at.i.msgs.b)
    (gth `@`la `@`lb)
  :-  %a
  %+  turn  sorted
  |=  [who=@p th=dm-thread]
  ^-  json
  =/  last  msgs.th
  %-  pairs
  :~  peer+s+(scot %p who)
      unread+(numb (dm-unread th))
      last-at+(numb ?~(last 0 (da-to-millis at.i.last)))
      last-text+s+?~(last '' text.i.last)
      last-author+s+?~(last '' (scot %p author.i.last))
  ==
::  full DM thread with one counterparty, oldest-first + our read stamp.
++  enjs-dm
  |=  who=@p
  ^-  json
  =,  enjs:format
  =/  th  (fall (~(get by dms) who) *dm-thread)
  %-  pairs
  :~  peer+s+(scot %p who)
      read+(numb (da-to-millis read.th))
      messages+a+(turn (flop msgs.th) chat-msg-json)
  ==
::
++  acl-to-json
  |=  acl=(map @p role)
  ^-  json
  =,  enjs:format
  :-  %a
  %+  turn  ~(tap by acl)
  |=  [who=@p =role]
  ^-  json
  %-  pairs
  :~  who+s+(scot %p who)
      role+s+(scot %tas role)
  ==
::
++  enjs-doc-meta
  |=  did=doc-id
  ^-  json
  =,  enjs:format
  =/  doc  (~(get by docs) did)
  ?^  doc
    (doc-summary did u.doc our.bowl %owner %.y)
  =/  m  (~(get by mirrors) did)
  ?~  m  ~
  %-  pairs
  :~  id+s+(scot %uv did)
      title+s+title.u.m
      type+s+(scot %tas doc-type.u.m)
      owner+s+(scot %p owner.u.m)
      role+s+(scot %tas role.u.m)
  ==
::
++  enjs-token-listing
  |=  sess=token-session
  ^-  json
  =,  enjs:format
  =/  doc  (~(get by docs) doc-id.sess)
  ?~  doc
    %-  pairs  ~[docs+a+~]
  %-  pairs
  :~  docs+a+~[(doc-summary doc-id.sess u.doc our.bowl role.sess %.n)]
  ==
::
++  enjs-doc-state
  |=  did=doc-id
  ^-  json
  =,  enjs:format
  =/  doc  (~(get by docs) did)
  ?^  doc
    %-  pairs
    :~  meta+(doc-summary did u.doc our.bowl %owner %.n)
        snapshot+(bytes-to-json blob.snapshot.u.doc)
        seq+(numb seq.snapshot.u.doc)
        :-  'updates'
        :-  %a
        %+  turn  (flop updates.u.doc)
        |=(su=stamped-update (bytes-to-json data.su))
    ==
  =/  m  (~(get by mirrors) did)
  ?~  m  ~
  %-  pairs
  :~  snapshot+(bytes-to-json blob.cached.u.m)
      seq+(numb seq.cached.u.m)
      updates+a+(turn (flop tail.u.m) bytes-to-json)
  ==
::
++  enjs-tokens-for
  |=  did=doc-id
  ^-  json
  =,  enjs:format
  =/  matching=(list [@uv token-grant])
    %+  skim  ~(tap by tokens)
    |=  [* g=token-grant]
    &(=(doc-id.g did) !revoked.g)
  %-  pairs
  :~  :-  'tokens'
      :-  %a
      %+  turn  matching
      |=  [tok=@uv g=token-grant]
      ^-  json
      %-  pairs
      :~  token+s+(scot %uv tok)
          role+s+(scot %tas role.g)
          created+(numb (da-to-millis created.g))
      ==
  ==
::
++  enjs-comments-for
  |=  did=doc-id
  ^-  json
  =,  enjs:format
  ::  Local docs serve their own comments; mirrors serve the owner-fanned
  ::  copies stored on the mirror record.
  =/  cmap=(map @uv comment)
    =/  doc  (~(get by docs) did)
    ?^  doc  comments.u.doc
    =/  m  (~(get by mirrors) did)
    ?~  m  *(map @uv comment)
    comments.u.m
  =/  pairs-list=(list [@uv comment])  ~(tap by cmap)
  =/  sorted=(list [@uv comment])
    %+  sort  pairs-list
    |=  [[* a=comment] [* b=comment]]
    (lth `@`created.a `@`created.b)
  %-  pairs
  :~  :-  'comments'
      :-  %a
      %+  turn  sorted
      |=  [cid=@uv c=comment]
      ^-  json
      %-  pairs
      :~  id+s+(scot %uv cid)
          author+s+(scot %p author.c)
          text+s+text.c
          anchor+s+anchor.c
          created+(numb (da-to-millis created.c))
          resolved+b+resolved.c
      ==
  ==
::
::  enjs-doc-history: timeline of the doc as the agent sees it — the
::  current snapshot (seq + size) plus an entry per buffered update with
::  its byte size and sequence. No per-update authorship (would require a
::  state bump; deferred to v1.1).
::
++  enjs-doc-history
  |=  did=doc-id
  ^-  json
  =,  enjs:format
  =/  doc  (~(get by docs) did)
  ?~  doc  (pairs ~[entries+a+~])
  =/  snap-entry=json
    %-  pairs
    :~  kind+s+'snapshot'
        seq+(numb seq.snapshot.u.doc)
        size+(numb p.blob.snapshot.u.doc)
    ==
  =/  update-entries=(list json)
    =|  idx=@ud
    =|  acc=(list json)
    |-  ^-  (list json)
    ?~  updates.u.doc  (flop acc)
    %=  $
      updates.u.doc  t.updates.u.doc
      idx            +(idx)
      acc
        :_  acc
        %-  pairs
        :~  kind+s+'update'
            idx+(numb idx)
            size+(numb p.data.i.updates.u.doc)
            author+s+(scot %p author.i.updates.u.doc)
            at+(numb (da-to-millis at.i.updates.u.doc))
        ==
    ==
  =/  entries=(list json)  [snap-entry update-entries]
  (pairs ~[entries+a+entries])
::
::  enjs-versions: checkpoint metadata (blobs served separately by ms key).
::
++  enjs-versions
  |=  did=doc-id
  ^-  json
  =,  enjs:format
  =/  doc  (~(get by docs) did)
  ?~  doc  (pairs ~[versions+a+~])
  %-  pairs
  :~  :-  'versions'
      :-  %a
      %+  turn  versions.u.doc
      |=  v=version
      ^-  json
      %-  pairs
      :~  at+(numb (da-to-millis at.v))
          author+s+(scot %p author.v)
          :-  'contributors'
          a+(turn ~(tap in contributors.v) |=(p=@p `json`s+(scot %p p)))
          label+?~(label.v ~ s+u.label.v)
          size+(numb p.blob.v)
      ==
  ==
::
::  enjs-version-blob: one checkpoint's full state, addressed by unix-ms.
::
++  enjs-version-blob
  |=  [did=doc-id at-ms=@ud]
  ^-  json
  =,  enjs:format
  =/  doc  (~(get by docs) did)
  ?~  doc  ~
  =/  hit
    %+  skim  versions.u.doc
    |=(v=version =((da-to-millis at.v) at-ms))
  ?~  hit  ~
  %-  pairs
  :~  at+(numb (da-to-millis at.i.hit))
      blob+(bytes-to-json blob.i.hit)
  ==
::
::  enjs-usage: loom-awareness dashboard — where the bytes live.
::
++  enjs-usage
  ^-  json
  =,  enjs:format
  =/  totals
    %+  roll  ~(tap by docs)
    |:  [[did=`doc-id`0v0 d=*document] acc=[upd=0 snap=0 vers=0]]
    :+  %+  add  upd.acc
        (roll updates.d |:([su=*stamped-update a=0] (add a p.data.su)))
      (add snap.acc p.blob.snapshot.d)
    %+  add  vers.acc
    (roll versions.d |:([v=*version a=0] (add a p.blob.v)))
  =/  blob-bytes
    %+  roll  ~(tap by blobs)
    |:  [[did=`doc-id`0v0 b=*file-blob] a=0]
    (add a size.b)
  %-  pairs
  :~  docs+(numb ~(wyt by docs))
      blobs+(numb ~(wyt by blobs))
      update-bytes+(numb upd.totals)
      snapshot-bytes+(numb snap.totals)
      version-bytes+(numb vers.totals)
      blob-bytes+(numb blob-bytes)
      total-bytes+(numb :(add upd.totals snap.totals vers.totals blob-bytes))
  ==
::
::  enjs-health: small status dashboard for monitors / smoke tests.
::
++  enjs-health
  ^-  json
  =,  enjs:format
  %-  pairs
  :~  version+s+'gw-0.2'
      state-version+(numb 12)
      docs+(numb ~(wyt by docs))
      mirrors+(numb ~(wyt by mirrors))
      tokens+(numb ~(wyt by tokens))
      sessions+(numb ~(wyt by sessions))
      sse-clients+(numb ~(wyt by sse-clients))
      pending-sse+(numb (lent pending-sse))
      spaces+(numb ~(wyt by spaces))
      dms+(numb ~(wyt by dms))
  ==
--
