::  +gittest — verify lib/git.hoon produces git-identical object hashes.
::    Expected (from real git):
::      empty-blob e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
::      empty-tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904
::      blob-hello ce013625030ba8dba906f756967f9e9ca394464a
::
/+  *git
:-  %say
|=  *
:-  %noun
=/  hello  (cat (cord-octs 'hello') (byt 10))
:~  ['empty-blob' (render-hash (hash-object [%blob emp]))]
    ['empty-tree' (render-hash -:(build-tree ~))]
    ['blob-hello' (render-hash (hash-object [%blob hello]))]
==
