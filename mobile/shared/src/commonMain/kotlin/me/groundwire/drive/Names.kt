package me.groundwire.drive

/** How ships are shown: a nickname when the space knows one, else a short @p. */
object Names {
    /**
     * "~ponnyd-toblun-libmex-tacsut--lanmus-tilrys-sattes-daplyd" ->
     * "~ponnyd-toblun" for a comet; planets and shorter names are kept whole.
     */
    fun short(ship: String): String {
        val s = if (ship.startsWith("~")) ship else "~$ship"
        val syllables = s.removePrefix("~").replace("--", "-").split("-")
        return if (syllables.size > 4) "~" + syllables.take(2).joinToString("-") else s
    }

    fun display(ship: String, nicknames: Map<String, String>, our: String?): String {
        val s = if (ship.startsWith("~")) ship else "~$ship"
        nicknames[s]?.takeIf { it.isNotBlank() }?.let { return it }
        if (our != null && s == our) return "You"
        return short(s)
    }
}
