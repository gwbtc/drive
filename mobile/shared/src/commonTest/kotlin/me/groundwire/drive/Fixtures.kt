package me.groundwire.drive

/**
 * Real responses captured from a comet's Drive on 2026-09-22 (ship names
 * shortened to keep the lines readable; shapes untouched).
 */
object Fixtures {
    val listing = """
        {"my-nickname":"Trent","space-invites":[],"mirrored":[],"dm-unread":0,"shared":[],
         "nicknames":{"~hadsec-winwel-parfel-datbyr--raglet-lorrex-dibnym-daplyd":"Yun",
                      "~nisfus-dosmet-mactyn-signul--motbur-posbep-tolpun-daplyd":"Robin",
                      "~ponnyd-toblun-libmex-tacsut--lanmus-tilrys-sattes-daplyd":"Trent"},
         "owned":[{"role":"owner","space":"0v3gr.mqs9e","title":"Test Doc","parent":null,"starred":false,"id":"0v3qc.o2gc1","type":"doc","modified":1789008000000}],
         "spaces":[{"role":"owner","joined":false,"name":"Groundwire","unread":2,"id":"0v3gr.mqs9e",
                    "host":"~ponnyd-toblun-libmex-tacsut--lanmus-tilrys-sattes-daplyd","members":6,"created":1789007948440}]}
    """.trimIndent()

    val listingWithInvite = """
        {"my-nickname":"","space-invites":[{"role":"editor","name":"Groundwire","id":"0v3gr.mqs9e",
         "host":"~ponnyd-toblun-libmex-tacsut--lanmus-tilrys-sattes-daplyd"}],
         "mirrored":[],"dm-unread":0,"shared":[],"nicknames":{},"owned":[],"spaces":[]}
    """.trimIndent()

    val dms = """
        [{"last-author":"~ponnyd-toblun-libmex-tacsut--lanmus-tilrys-sattes-daplyd",
          "peer":"~fossyd-hadter-simred-lasmyr--bonseg-molryc-nibbec-daplyd",
          "last-text":"0v3gr.mqs9e","unread":0,"last-at":1789575681810},
         {"last-author":"","peer":"~ponnyd-toblun-libmex-tacsut--lanmus-tilrys-sattes-daplyd","last-text":"","unread":0,"last-at":0}]
    """.trimIndent()

    val chat = """
        {"messages":[
          {"author":"~ponnyd-toblun-libmex-tacsut--lanmus-tilrys-sattes-daplyd","text":"Hello everyone!","id":"0v3e9.l89qb","at":1789008315170},
          {"author":"~nisfus-dosmet-mactyn-signul--motbur-posbep-tolpun-daplyd","text":"hello","id":"0v2np.j06cc","at":1789575629841},
          {"author":"~fossyd-hadter-simred-lasmyr--bonseg-molryc-nibbec-daplyd","text":"hi","id":"0v3fj.ekusn","at":1789575720000}],
         "read":1789575629841}
    """.trimIndent()

    val dm = """
        {"peer":"~fossyd-hadter-simred-lasmyr--bonseg-molryc-nibbec-daplyd","read":0,
         "messages":[{"author":"~ponnyd-toblun-libmex-tacsut--lanmus-tilrys-sattes-daplyd","text":"0v3gr.mqs9e","id":"0v1.abc","at":1789575681810}]}
    """.trimIndent()
}
