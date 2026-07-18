::  /lib/git.hoon
::    A from-scratch git codec: object hashing (SHA-1, byte-identical to git),
::    object serialization, packfile generation, pkt-line + zlib framing —
::    enough to serve a real `git clone`/`fetch` to a stock git client.
::
::    Byte strings are `octs` [len=@ud bytes=@], bytes LSB-first (Urbit's native
::    atom order, matching cords). We never need a zlib *compressor*: we emit
::    DEFLATE "stored" (uncompressed) blocks, which every git client inflates.
::
/-  *code
|%
::  === octs (byte-string) helpers ====================================
::
++  emp  `octs`[0 0]                                   ::  empty byte string
++  byt  |=(b=@ `octs`[1 (mod b 256)])                 ::  a single byte
++  cat                                                ::  concat a THEN b
  |=  [a=octs b=octs]
  ^-  octs
  [(add p.a p.b) (con q.a (lsh [3 p.a] q.b))]
++  cats                                               ::  concat a list of octs
  |=  os=(list octs)
  ^-  octs
  (roll os |:([o=emp acc=emp] (cat acc o)))
++  as-cord  |=(=octs `@t`q.octs)                      ::  octs → cord (bytes as-is)
++  cord-octs  |=(t=@t `octs`[(met 3 t) t])            ::  cord → octs
::  render a @ud as bare ascii decimal (no dots), e.g. 1000 → "1000"
++  deci
  |=  n=@ud
  ^-  @t
  ?:  =(n 0)  '0'
  =/  ds=(list @)  ~
  =/  m  n
  |-
  ?:  =(m 0)  (rap 3 ds)
  $(m (div m 10), ds [(add '0' (mod m 10)) ds])
::  big-endian bytes of `wid`-wide atom `a` as octs (a[hi]..a[lo] in stream)
++  be
  |=  [wid=@ud a=@]
  ^-  octs
  [wid (rev 3 wid a)]
::
::  === SHA-1, byte-identical to git ==================================
::  `shan` is Urbit's jetted SHA-1. It returns a big-endian digest (verified:
::  `(shan 0)` = SHA1("")). We feed it the byte string most-significant-byte-
::  first so (a) the byte order matches git and (b) a trailing NUL is preserved
::  (git object strings never lead with a NUL, so the high byte is always
::  significant → `met` gives the true length).
::
::  RUNTIME NOTE: jetted crypto is NOT available in a gall `on-peek` (scry) —
::  `shan` bails there on non-empty input. Every caller of `sha1` must run in a
::  poke / HTTP-handler context (object-creation actions; pack generation in the
::  git-upload-pack route), never in a scry. See docs/code-hosting.md.
::
++  sha1  |=(o=octs ^-(hash (shan (rev 3 p.o q.o))))
::  raw 20-byte digest as octs, big-endian (as git writes it into trees/packs)
++  sha1-raw  |=(o=octs `octs`(be 20 (sha1 o)))
::
::  === git objects ==================================================
::  The loose-object serialization that gets hashed: "<type> <size>\0<content>".
::
++  otype-tag
  |=(=otype ?-(otype %blob 'blob', %tree 'tree', %commit 'commit', %tag 'tag'))
++  loose
  |=  =gobject
  ^-  octs
  %-  cats
  :~  (cord-octs (otype-tag otype.gobject))
      (byt ' ')
      (cord-octs (deci p.content.gobject))
      (byt 0)
      content.gobject
  ==
++  hash-object  |=(=gobject ^-(hash (sha1 (loose gobject))))
::
::  --- trees ---
::  entries are "<mode> <name>\0<20-raw-sha>" concatenated, sorted by name
::  (a subtree name sorts as if it had a trailing '/').
++  tree-sort-key  |=(e=tree-entry ?:(=('40000' mode.e) (cat (cord-octs name.e) (byt '/')) (cord-octs name.e)))
++  octs-lte                                           ::  bytewise a <= b
  |=  [a=octs b=octs]
  ^-  ?
  =/  i  0
  |-
  ?:  =(i p.a)  %.y                                    ::  a is a prefix of b (or equal)
  ?:  =(i p.b)  %.n
  =/  ba  (cut 3 [i 1] q.a)
  =/  bb  (cut 3 [i 1] q.b)
  ?:  (lth ba bb)  %.y
  ?:  (gth ba bb)  %.n
  $(i +(i))
++  serialize-tree
  |=  entries=(list tree-entry)
  ^-  octs
  =/  sorted
    %+  sort  entries
    |=([a=tree-entry b=tree-entry] (octs-lte (tree-sort-key a) (tree-sort-key b)))
  %-  cats
  %+  turn  sorted
  |=  e=tree-entry
  (cats ~[(cord-octs mode.e) (byt ' ') (cord-octs name.e) (byt 0) (be 20 hash.e)])
::  build a tree object from entries
++  build-tree
  |=  entries=(list tree-entry)
  ^-  [hash gobject]
  =/  o=gobject  [%tree (serialize-tree entries)]
  [(hash-object o) o]
::
::  --- commits ---
++  serialize-commit
  |=  c=commit
  ^-  octs
  =/  lines=(list @t)
    %-  zing
    :~  ~['tree ' (render-hash tree.c) '\0a']
        (zing (turn parents.c |=(p=hash ~['parent ' (render-hash p) '\0a'])))
        ~['author ' author.c '\0a']
        ~['committer ' committer.c '\0a']
        ~['\0a' message.c]
    ==
  (cord-octs (rap 3 lines))
++  build-commit
  |=  c=commit
  ^-  [hash gobject]
  =/  o=gobject  [%commit (serialize-commit c)]
  [(hash-object o) o]
++  build-blob
  |=  body=octs
  ^-  [hash gobject]
  =/  o=gobject  [%blob body]
  [(hash-object o) o]
::  a git object id as 40-char lowercase hex (no leading 0x, zero-padded)
++  render-hash
  |=  =hash
  ^-  @t
  ::  strip the "0x" prefix + the dot separators `scot %ux` inserts, lowercase,
  ::  left-pad to 40 hex chars (git zero-pads short ids, e.g. a leading-0 hash).
  =/  raw  (skip (slag 2 (trip (scot %ux hash))) |=(c=@tD =('.' c)))
  =/  n  (lent raw)
  (crip (weld (reap (sub 40 (min 40 n)) '0') raw))
::  parse a 40-char lowercase-hex id back to a @ux (manual fold; git hex has no
::  dots, so `slav %ux` won't take it)
++  parse-hash
  |=  t=@t
  ^-  hash
  %+  roll  (trip t)
  |=  [c=@tD acc=@ux]
  =/  v=@  ?:((lte c '9') (sub c '0') (add 10 (sub c 'a')))
  (add (mul acc 16) v)
::
::  === walking the object graph (for pack generation) ================
::  parse just enough of a commit to find its tree + parents
++  parse-commit-refs
  |=  content=octs
  ^-  [tree=hash parents=(list hash)]
  =/  lines  (to-wain:format (as-cord content))         ::  split on newlines
  =|  tree=hash
  =|  parents=(list hash)
  |-  ^-  [hash (list hash)]
  ?~  lines  [tree (flop parents)]
  =/  ln  (trip i.lines)
  ?:  =('' i.lines)  [tree (flop parents)]              ::  blank → headers done
  ?:  =("tree " (scag 5 ln))
    $(lines t.lines, tree (parse-hash (crip (slag 5 ln))))
  ?:  =("parent " (scag 7 ln))
    $(lines t.lines, parents [(parse-hash (crip (slag 7 ln))) parents])
  $(lines t.lines)
::  parse a tree into its child hashes (with types unknown → resolve via store)
++  parse-tree-hashes
  |=  content=octs
  ^-  (list hash)
  =/  i  0
  =|  out=(list hash)
  |-  ^-  (list hash)
  ?:  (gte i p.content)  (flop out)
  ::  entry: <mode> SP <name> NUL <20 raw sha>
  =/  sp  |-(^-(@ud ?:(=(' ' (cut 3 [i 1] q.content)) i $(i +(i)))))
  =/  nul  |-(^-(@ud ?:(=(0 (cut 3 [i 1] q.content)) i $(i +(i)))))
  =/  raw  (cut 3 [+(nul) 20] q.content)                ::  20 raw bytes, LSB-first
  =/  =hash  (rev 3 20 raw)                             ::  → big-endian id
  $(i (add nul 21), out [hash out])
::  collect every object reachable from a commit (commit→tree→subtrees→blobs)
++  reachable
  |=  [start=hash objects=(map hash gobject)]
  ^-  (list hash)
  =/  stack=(list hash)  ~[start]
  =|  seen=(set hash)
  |-  ^-  (list hash)
  ?~  stack  ~(tap in seen)
  =/  h  i.stack
  ?:  (~(has in seen) h)  $(stack t.stack)
  =/  obj  (~(get by objects) h)
  ?~  obj  $(stack t.stack)                             ::  missing (thin) — skip
  =.  seen  (~(put in seen) h)
  ?-  otype.u.obj
      %blob  $(stack t.stack)
      %tag   $(stack t.stack)
      %commit
    =/  refs  (parse-commit-refs content.u.obj)
    $(stack (weld [tree.refs parents.refs] t.stack))
      %tree
    $(stack (weld (parse-tree-hashes content.u.obj) t.stack))
  ==
::
::  === zlib framing (stored/uncompressed DEFLATE blocks) =============
::
++  adler32
  |=  o=octs
  ^-  @ux
  =/  s1  1
  =/  s2  0
  =/  i  0
  |-  ^-  @ux
  ?:  =(i p.o)  (con (lsh [0 16] s2) s1)
  =/  b  (cut 3 [i 1] q.o)
  =.  s1  (mod (add s1 b) 65.521)
  =.  s2  (mod (add s2 s1) 65.521)
  $(i +(i))
::  wrap octs in a zlib stream using stored blocks (max 65535 bytes each)
++  zlib
  |=  o=octs
  ^-  octs
  =/  header=octs  [2 0x178]                            ::  0x78 0x01, LSB-first
  =/  a  (be 4 (adler32 o))                             ::  adler32, big-endian
  =/  blocks
    =/  off  0
    =|  acc=(list octs)
    |-  ^-  (list octs)
    =/  remain  (sub p.o off)
    ?:  =(0 remain)
      ?:  =(0 p.o)  (flop [(stored-block emp %.y) acc])  ::  empty → one empty final block
      (flop acc)
    =/  take  (min remain 65.535)
    =/  chunk=octs  [take (cut 3 [off take] q.o)]
    =/  final  =((add off take) p.o)
    $(off (add off take), acc [(stored-block chunk final) acc])
  (cats (weld [header blocks] ~[a]))
++  stored-block                                        ::  one DEFLATE stored block
  |=  [chunk=octs final=?]
  ^-  octs
  =/  hdr=octs  [1 ?:(final 1 0)]                       ::  BFINAL bit
  =/  len=octs  [2 p.chunk]                             ::  LEN, little-endian
  =/  nlen=octs  [2 (mix p.chunk 0xffff)]               ::  NLEN = ~LEN
  (cats ~[hdr len nlen chunk])
::
::  === packfile (v2) generation, no deltas ==========================
::  Every object emitted as a base object (type 1-4) + a zlib stream of its
::  raw content. Stock git accepts fully-undeltified packs.
::
++  obj-type-code  |=(=otype ?-(otype %commit 1, %tree 2, %blob 3, %tag 4))
::  the variable-length pack object header: 3-bit type + size (7-bit groups)
++  pack-obj-header
  |=  [=otype size=@ud]
  ^-  octs
  =/  ty  (obj-type-code otype)
  =/  b0  (con (lsh [0 4] ty) (dis size 0xf))           ::  type<<4 | low-4-of-size
  =/  rest  (rsh [0 4] size)
  ?:  =(0 rest)  (byt b0)
  =/  out=(list @)  ~[(con b0 0x80)]                     ::  set continuation
  =/  s  rest
  |-  ^-  octs
  ?:  =(0 s)  [(lent out) (rep 3 (flop out))]
  =/  seven  (dis s 0x7f)
  =/  more  (rsh [0 7] s)
  ?:  =(0 more)
    $(out [seven out], s 0)
  $(out [(con seven 0x80) out], s more)
++  pack-object
  |=  [=hash =gobject]
  ^-  octs
  (cat (pack-obj-header otype.gobject p.content.gobject) (zlib content.gobject))
::  build a full packfile for the given objects (order: any; we emit as given)
++  make-pack
  |=  objs=(list [hash gobject])
  ^-  octs
  =/  head=octs  (cats ~[(cord-octs 'PACK') (be 4 2) (be 4 (lent objs))])
  =/  body=octs
    %+  roll  objs
    |:  [o=*[hash gobject] acc=head]
    (cat acc (pack-object o))
  ::  trailer = SHA-1 of everything so far, raw 20 bytes big-endian
  (cat body (be 20 (sha1 body)))
::
::  === pkt-line framing =============================================
::
++  pkt                                                 ::  frame one payload
  |=  payload=octs
  ^-  octs
  =/  n  (add 4 p.payload)
  (cat (cord-octs (hex4 n)) payload)
++  pkt-cord  |=(t=@t (pkt (cord-octs t)))
++  flush  `octs`(cord-octs '0000')                     ::  flush-pkt
++  hex4                                                ::  @ud → 4 lowercase hex chars
  |=  n=@ud
  ^-  @t
  =/  h  (skip (slag 2 (trip (scot %ux n))) |=(c=@tD =('.' c)))  ::  strip "0x" + dots
  =/  h  (weld (reap (sub 4 (min 4 (lent h))) '0') h)
  (crip h)
--
