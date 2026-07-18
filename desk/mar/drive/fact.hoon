::  /mar/drive/fact.hoon
::    Facts published on /doc/<id> subscriptions. Casts to JSON for browser delivery.
::
/-  *drive
|_  fac=fact
++  grow
  |%
  ++  noun  fac
  ++  json
    ^-  ^json
    =,  enjs:format
    =/  bytes-to-json
      |=  =octs
      ^-  ^json
      :-  %a
      =/  bs=(list @ud)  (rip 3 q.octs)
      =/  pad=@ud
        ?:((gth p.octs (lent bs)) (sub p.octs (lent bs)) 0)
      =/  padded=(list @ud)  (weld bs (reap pad 0))
      %+  turn  padded
      |=(b=@ud (numb b))
    =/  da-to-millis
      |=  =@da
      ^-  @ud
      =/  ms-per-sec=@dr  (div ~s1 1.000)
      ?:  (lth da ~1970.1.1)  0
      (div (sub da ~1970.1.1) ms-per-sec)
    =/  msg-to-json
      |=  m=chat-msg
      ^-  ^json
      %-  pairs
      :~  id+s+(scot %uv msg-id.m)
          author+s+(scot %p author.m)
          text+s+text.m
          at+(numb (da-to-millis at.m))
      ==
    ?-  -.fac
        %snapshot
      %-  pairs
      :~  type+s+'snapshot'
          seq+(numb seq.fac)
          blob+(bytes-to-json blob.fac)
      ==
        %update
      %-  pairs
      :~  type+s+'update'
          update+(bytes-to-json update.fac)
      ==
        %awareness
      %-  pairs
      :~  type+s+'awareness'
          ship+s+(scot %p ship.fac)
          blob+(bytes-to-json blob.fac)
      ==
        %role-change
      %-  pairs
      :~  type+s+'role-change'
          who+s+(scot %p who.fac)
          role+s+(scot %tas role.fac)
      ==
        %revoked
      %-  pairs
      :~  type+s+'revoked'
      ==
        %request-snapshot
      %-  pairs
      :~  type+s+'request-snapshot'
      ==
        %meta
      %-  pairs
      :~  type+s+'meta'
          title+s+title.fac
          modified+(numb (da-to-millis modified.fac))
          doc-type+s+(scot %tas doc-type.fac)
      ==
        %trashed
      %-  pairs
      :~  type+s+'trashed'
          at+(numb (da-to-millis at.fac))
      ==
        %blob
      ::  bytes intentionally omitted — mirrors receive them over ames as
      ::  nouns and browsers fetch /blob; JSON-encoding megabytes is out.
      %-  pairs
      :~  type+s+'blob'
          mime+s+mime.fac
      ==
        %comment-add
      %-  pairs
      :~  type+s+'comment-add'
          id+s+(scot %uv comment-id.fac)
          author+s+(scot %p author.comment.fac)
          text+s+text.comment.fac
          anchor+s+anchor.comment.fac
          created+(numb (da-to-millis created.comment.fac))
          resolved+b+resolved.comment.fac
      ==
        %comment-resolved
      %-  pairs
      :~  type+s+'comment-resolved'
          id+s+(scot %uv comment-id.fac)
      ==
        %comment-deleted
      %-  pairs
      :~  type+s+'comment-deleted'
          id+s+(scot %uv comment-id.fac)
      ==
        %save-failed
      %-  pairs
      :~  type+s+'save-failed'
      ==
        %space-meta
      %-  pairs
      :~  type+s+'space-meta'
          name+s+name.fac
          role+s+(scot %tas space-role.fac)
      ==
        %space-doc
      %-  pairs
      :~  type+s+'space-doc'
          id+s+(scot %uv doc-id.fac)
          title+s+title.space-doc.fac
          doc-type+s+(scot %tas doc-type.space-doc.fac)
          modified+(numb (da-to-millis modified.space-doc.fac))
      ==
        %space-doc-gone
      %-  pairs
      :~  type+s+'space-doc-gone'
          id+s+(scot %uv doc-id.fac)
      ==
        %space-roster
      %-  pairs
      :~  type+s+'space-roster'
          :-  %members
          :-  %a
          %+  turn  ~(tap by members.fac)
          |=  [who=@p =space-role]
          ^-  ^json
          (pairs ~[who+s+(scot %p who) role+s+(scot %tas space-role)])
      ==
        %space-kicked
      %-  pairs
      :~  type+s+'space-kicked'
      ==
        %space-chat-log
      %-  pairs
      :~  type+s+'space-chat-log'
          msgs+a+(turn msgs.fac msg-to-json)
      ==
        %space-chat-msg
      %-  pairs
      :~  type+s+'space-chat-msg'
          msg+(msg-to-json chat-msg.fac)
      ==
        %space-chat-del
      %-  pairs
      :~  type+s+'space-chat-del'
          id+s+(scot %uv msg-id.fac)
      ==
    ==
  --
++  grab
  |%
  ++  noun  fact
  --
++  grad  %noun
--
