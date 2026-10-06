package analysis

import (
	"fmt"
	"sort"

	"github.com/abdurryy/CerlockCS/internal/match"
)

const maxMoments = 12

func (a *analyzer) name(p int) string {
	if p < 0 || p >= len(a.m.Players) {
		return "world"
	}
	return a.m.Players[p].Name
}

func (a *analyzer) add(in Insight) {
	if len(in.Moments) > maxMoments {
		in.Moments = in.Moments[:maxMoments]
	}
	if in.Moments == nil {
		in.Moments = []Moment{}
	}
	a.r.Insights = append(a.r.Insights, in)
}

func rnd(r int) string { return fmt.Sprintf("R%d", r+1) }

func pct(n, d int) float64 {
	if d == 0 {
		return 0
	}
	return float64(n) / float64(d) * 100
}

func (a *analyzer) killMoment(k int, label string) Moment {
	kl := a.m.Kills[k]
	// Start a few seconds early so the fight can be watched building up.
	return Moment{Round: kl.Round, Tick: kl.Tick - int(4*a.rate), Player: kl.Victim, Label: label}
}

func (a *analyzer) insights() {
	for t := 0; t < 2; t++ {
		a.teamInsights(t)
	}
	for p := range a.m.Players {
		if a.r.Players[p].Rounds >= 5 {
			a.playerInsights(p)
		}
	}
	order := map[Severity]int{High: 0, Medium: 1, Low: 2, Positive: 3}
	sort.SliceStable(a.r.Insights, func(i, j int) bool {
		x, y := a.r.Insights[i], a.r.Insights[j]
		if order[x.Severity] != order[y.Severity] {
			return order[x.Severity] < order[y.Severity]
		}
		return x.Player < y.Player
	})
}

func (a *analyzer) teamInsights(t int) {
	m := a.m
	ts := a.r.Teams[t]
	team := m.Teams[t].Name
	rounds := len(m.Rounds)

	// Opening duels.
	if od := ts.OpeningKills + ts.OpeningDeaths; od >= 6 {
		rate := float64(ts.OpeningKills) / float64(od)
		ct, tt := ts.OpeningBySide["CT"], ts.OpeningBySide["T"]
		if rate <= 0.4 {
			sev := Medium
			if rate <= 0.3 {
				sev = High
			}
			in := Insight{
				ID: "team-opening", Severity: sev, Team: t, Player: -1,
				Title: "Losing the opening duel",
				Detail: fmt.Sprintf("%s lost %d of %d opening duels (CT %d/%d won, T %d/%d won). After losing the first duel they won %d of %d rounds.",
					team, ts.OpeningDeaths, od, ct.Won, ct.Played, tt.Won, tt.Played, ts.DisadvantageRounds.Won, ts.DisadvantageRounds.Played),
				Tip: "Check who takes the first fight and how. A first contact without a flash or a second player ready to trade is mostly a coin flip.",
			}
			for _, info := range a.r.Rounds {
				if info.OpeningKill >= 0 && a.teamOf(m.Kills[info.OpeningKill].Victim) == t {
					k := m.Kills[info.OpeningKill]
					in.Moments = append(in.Moments, a.killMoment(info.OpeningKill, fmt.Sprintf("%s %s died first to %s", rnd(k.Round), a.name(k.Victim), a.name(k.Killer))))
				}
			}
			a.add(in)
		} else if rate >= 0.6 {
			a.add(Insight{
				ID: "team-opening", Severity: Positive, Team: t, Player: -1,
				Title:  "Winning the opening duel",
				Detail: fmt.Sprintf("%s won %d of %d opening duels and converted %d of those rounds.", team, ts.OpeningKills, od, ts.AdvantageRounds.Won),
			})
		}
	}

	// Trading. Around a quarter of deaths get traded in a normal game.
	if ts.Deaths >= 8 {
		if ts.TradeRate < 20 {
			sev := Medium
			if ts.TradeRate < 12 {
				sev = High
			}
			in := Insight{
				ID: "team-trading", Severity: sev, Team: t, Player: -1,
				Title: "Deaths are not getting traded",
				Detail: fmt.Sprintf("Only %d of %d deaths (%.0f%%) were traded within %.0f seconds. When a player died the closest teammate was on average %.0f units away.",
					ts.TradedDeaths, ts.Deaths, ts.TradeRate, tradeWindow, ts.AvgTeammateDistance),
				Tip: "Take contact in pairs. The second player should be close enough to swing the same angle right after the first one.",
			}
			type d struct {
				k    int
				dist float64
			}
			var list []d
			for i, k := range m.Kills {
				if a.teamOf(k.Victim) == t && !a.traded[i] && k.Killer >= 0 && a.enemies(k.Killer, k.Victim) {
					list = append(list, d{i, a.mateDist[i]})
				}
			}
			sort.Slice(list, func(i, j int) bool { return list[i].dist > list[j].dist })
			for _, x := range list {
				k := m.Kills[x.k]
				label := fmt.Sprintf("%s %s died untraded, nearest teammate %.0fu away", rnd(k.Round), a.name(k.Victim), x.dist)
				if x.dist < 0 {
					label = fmt.Sprintf("%s %s died untraded as the last player alive", rnd(k.Round), a.name(k.Victim))
				}
				in.Moments = append(in.Moments, a.killMoment(x.k, label))
			}
			a.add(in)
		} else if ts.TradeRate >= 35 {
			a.add(Insight{
				ID: "team-trading", Severity: Positive, Team: t, Player: -1,
				Title:  "Good trading",
				Detail: fmt.Sprintf("%.0f%% of deaths were traded within %.0f seconds.", ts.TradeRate, tradeWindow),
			})
		}
	}

	// Rounds thrown after getting the first kill.
	if adv := ts.AdvantageRounds; adv.Played >= 4 && float64(adv.Won)/float64(adv.Played) < 0.6 {
		in := Insight{
			ID: "team-advantage", Severity: Medium, Team: t, Player: -1,
			Title:  "Not converting the man advantage",
			Detail: fmt.Sprintf("%s got the first kill in %d rounds but only won %d of them.", team, adv.Played, adv.Won),
			Tip:    "After the first kill, slow down and use the numbers. Most of these rounds are lost to spread out players taking separate fights.",
		}
		for ri, info := range a.r.Rounds {
			if info.OpeningKill >= 0 && a.teamOf(m.Kills[info.OpeningKill].Killer) == t && m.Rounds[ri].WinnerTeam != t {
				k := m.Kills[info.OpeningKill]
				in.Moments = append(in.Moments, Moment{Round: ri, Tick: k.Tick, Player: k.Killer, Label: fmt.Sprintf("%s lost after %s got the first kill", rnd(ri), a.name(k.Killer))})
			}
		}
		a.add(in)
	}

	// Team flashes.
	if ts.TeamFlashes >= 4 || ts.TeamBlindTime >= 8 {
		sev := Medium
		if ts.TeamFlashes >= 8 || ts.TeamBlindTime >= 15 {
			sev = High
		}
		in := Insight{
			ID: "team-flashes", Severity: sev, Team: t, Player: -1,
			Title:  "Flashing teammates",
			Detail: fmt.Sprintf("Teammates were blinded for more than a second %d times by their own flashes, %.1f seconds of blindness in total.", ts.TeamFlashes, ts.TeamBlindTime),
			Tip:    "Call flashes before throwing and learn pop flashes for the common executes so they do not need to be thrown over teammates.",
		}
		in.Moments = a.teamFlashMoments(func(b match.Blind) bool { return a.teamOf(b.Attacker) == t })
		a.add(in)
	}

	// Unused utility.
	if ts.UnusedUtility >= 2500 {
		sev := Low
		if ts.UnusedUtility >= 5000 {
			sev = Medium
		}
		in := Insight{
			ID: "team-unused-util", Severity: sev, Team: t, Player: -1,
			Title:  "Dying with utility",
			Detail: fmt.Sprintf("$%d worth of grenades was still in the pockets of dead players.", ts.UnusedUtility),
			Tip:    "Grenades left on a dead player are wasted money. Use them earlier, or drop them for a teammate before a risky peek.",
		}
		in.Moments = a.unusedUtilMoments(func(k match.Kill) bool { return a.teamOf(k.Victim) == t })
		a.add(in)
	}

	// Anti-eco losses.
	if ae := ts.AntiEco; ae.Played-ae.Won >= 2 {
		sev := Medium
		if ae.Played-ae.Won >= 3 {
			sev = High
		}
		in := Insight{
			ID: "team-anti-eco", Severity: sev, Team: t, Player: -1,
			Title:  "Losing anti-eco rounds",
			Detail: fmt.Sprintf("Lost %d of %d rounds with a full buy against an eco or force buy.", ae.Played-ae.Won, ae.Played),
			Tip:    "Against weaker buys, avoid close range fights and peeking alone. Keep distance and let the better weapons do the work.",
		}
		for ri, info := range a.r.Rounds {
			if info.BuyType[t] == "full" && (info.BuyType[1-t] == "eco" || info.BuyType[1-t] == "force") && m.Rounds[ri].WinnerTeam != t {
				in.Moments = append(in.Moments, Moment{Round: ri, Tick: m.Rounds[ri].FreezeEndTick, Player: -1,
					Label: fmt.Sprintf("%s lost a full buy against %s ($%d vs $%d)", rnd(ri), buyName(info.BuyType[1-t]), info.EquipValue[t], info.EquipValue[1-t])})
			}
		}
		a.add(in)
	}

	// Post plants.
	if pl := ts.Plants; pl.Played >= 3 && float64(pl.Won)/float64(pl.Played) < 0.5 {
		in := Insight{
			ID: "team-post-plant", Severity: Medium, Team: t, Player: -1,
			Title:  "Losing post-plant situations",
			Detail: fmt.Sprintf("Planted the bomb %d times on T side but only won %d of those rounds.", pl.Played, pl.Won),
			Tip:    "Agree on post-plant positions before the execute and keep utility for the retake, especially molotovs for the defuse spot.",
		}
		for _, b := range m.BombEvents {
			if b.Kind == "planted" && b.Round < rounds && m.Rounds[b.Round].SideOf[t] == match.SideT && m.Rounds[b.Round].WinnerTeam != t {
				in.Moments = append(in.Moments, Moment{Round: b.Round, Tick: b.Tick, Player: b.Player, Label: fmt.Sprintf("%s bomb planted on %s, round lost", rnd(b.Round), b.Site)})
			}
		}
		a.add(in)
	}
	if rt := ts.Retakes; rt.Played >= 3 && float64(rt.Won)/float64(rt.Played) >= 0.5 {
		a.add(Insight{
			ID: "team-retakes", Severity: Positive, Team: t, Player: -1,
			Title:  "Strong retakes",
			Detail: fmt.Sprintf("Won %d of %d rounds on CT side after the bomb was planted.", rt.Won, rt.Played),
		})
	}

	if rounds >= 8 && ts.UtilPerRound < 2 {
		a.add(Insight{
			ID: "team-util-usage", Severity: Low, Team: t, Player: -1,
			Title:  "Little utility used",
			Detail: fmt.Sprintf("The team threw %.1f grenades per round on average.", ts.UtilPerRound),
			Tip:    "Even a single smoke or flash per player changes how fights are taken. Plan at least one piece of utility per player per round.",
		})
	}

	if p := ts.Pistol; p.Played >= 2 && p.Won == 0 {
		a.add(Insight{
			ID: "team-pistols", Severity: Low, Team: t, Player: -1,
			Title:  "Lost both pistol rounds",
			Detail: "Both pistol rounds were lost, which usually costs the next two or three rounds as well.",
		})
	}
	if f := ts.Buys["force"]; f != nil && f.Won >= 2 && pct(f.Won, f.Played) >= 40 {
		a.add(Insight{
			ID: "team-force", Severity: Positive, Team: t, Player: -1,
			Title:  "Force buys paid off",
			Detail: fmt.Sprintf("Won %d of %d force or half buy rounds.", f.Won, f.Played),
		})
	}
}

func (a *analyzer) teamFlashMoments(filter func(match.Blind) bool) []Moment {
	var list []match.Blind
	for _, b := range a.m.Blinds {
		if b.Attacker >= 0 && b.Attacker != b.Victim && !a.enemies(b.Attacker, b.Victim) && float64(b.Duration) >= minBlind && filter(b) {
			list = append(list, b)
		}
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Duration > list[j].Duration })
	var out []Moment
	for _, b := range list {
		out = append(out, Moment{Round: b.Round, Tick: b.Tick - int(2*a.rate), Player: b.Victim,
			Label: fmt.Sprintf("%s %s flashed %s for %.1fs", rnd(b.Round), a.name(b.Attacker), a.name(b.Victim), b.Duration)})
	}
	return out
}

func (a *analyzer) unusedUtilMoments(filter func(match.Kill) bool) []Moment {
	type entry struct {
		k     int
		value int
	}
	var list []entry
	for i, k := range a.m.Kills {
		if len(k.VictimUtility) == 0 || !filter(k) {
			continue
		}
		v := 0
		for _, u := range k.VictimUtility {
			v += utilityPrice[u]
		}
		list = append(list, entry{i, v})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].value > list[j].value })
	var out []Moment
	for _, e := range list {
		k := a.m.Kills[e.k]
		out = append(out, a.killMoment(e.k, fmt.Sprintf("%s %s died holding $%d of utility", rnd(k.Round), a.name(k.Victim), e.value)))
	}
	return out
}

func (a *analyzer) lobbyMedian(get func(match.Engagement) float64, min float64) float64 {
	var v []float64
	for _, e := range a.m.Engagements {
		if x := get(e); x >= min {
			v = append(v, x)
		}
	}
	return median(v, 10)
}

func (a *analyzer) playerInsights(p int) {
	m := a.m
	st := a.r.Players[p]
	ai := a.r.Aim[p]
	t := a.teamOf(p)
	name := a.name(p)

	// Opening duels.
	if att := st.OpeningKills + st.OpeningDeaths; att >= 4 {
		rate := float64(st.OpeningKills) / float64(att)
		if st.OpeningDeaths >= 3 && rate <= 0.3 {
			in := Insight{
				ID: "player-opening", Severity: Medium, Team: t, Player: p,
				Title:  "Losing opening duels",
				Detail: fmt.Sprintf("%s took %d opening duels and won %d.", name, att, st.OpeningKills),
				Tip:    "If the first fight keeps going wrong, change the timing or the angle, or ask for a flash before peeking.",
			}
			for _, info := range a.r.Rounds {
				if info.OpeningKill >= 0 && m.Kills[info.OpeningKill].Victim == p {
					k := m.Kills[info.OpeningKill]
					in.Moments = append(in.Moments, a.killMoment(info.OpeningKill, fmt.Sprintf("%s died first to %s", rnd(k.Round), a.name(k.Killer))))
				}
			}
			a.add(in)
		} else if st.OpeningKills >= 4 && rate >= 0.65 {
			a.add(Insight{
				ID: "player-opening", Severity: Positive, Team: t, Player: p,
				Title:  "Strong opening duels",
				Detail: fmt.Sprintf("%s won %d of %d opening duels.", name, st.OpeningKills, att),
			})
		}
	}

	// Isolated deaths.
	if st.IsolatedDeaths >= 3 && pct(st.IsolatedDeaths, st.Deaths) >= 20 {
		in := Insight{
			ID: "player-isolated", Severity: Medium, Team: t, Player: p,
			Title:  "Dying where nobody can trade",
			Detail: fmt.Sprintf("%d of %s's %d deaths happened with no teammate within %.0f units.", st.IsolatedDeaths, name, st.Deaths, isolationDistance),
			Tip:    "Before taking a fight, check where the closest teammate is. If nobody can trade, play for info and fall back instead.",
		}
		for i, k := range m.Kills {
			if k.Victim == p && !a.traded[i] && a.mateDist[i] > isolationDistance {
				in.Moments = append(in.Moments, a.killMoment(i, fmt.Sprintf("%s died %.0fu from the closest teammate", rnd(k.Round), a.mateDist[i])))
			}
		}
		a.add(in)
	}

	// Early deaths.
	if st.EarlyDeaths >= 3 && pct(st.EarlyDeaths, st.Rounds) >= 20 {
		in := Insight{
			ID: "player-early-deaths", Severity: Medium, Team: t, Player: p,
			Title:  "Dying early in rounds",
			Detail: fmt.Sprintf("%s died within %.0f seconds of freeze time ending in %d of %d rounds.", name, earlyDeathSeconds, st.EarlyDeaths, st.Rounds),
			Tip:    "Early deaths leave the team a player down for the whole round. Look for the common spot or timing in these rounds.",
		}
		for i, k := range m.Kills {
			if k.Victim == p && k.Round < len(m.Rounds) && a.seconds(k.Tick-m.Rounds[k.Round].FreezeEndTick) < earlyDeathSeconds {
				in.Moments = append(in.Moments, a.killMoment(i, fmt.Sprintf("%s died after %.0fs", rnd(k.Round), a.seconds(k.Tick-m.Rounds[k.Round].FreezeEndTick))))
			}
		}
		a.add(in)
	}

	if st.TeammatesFlashed >= 3 {
		in := Insight{
			ID: "player-team-flash", Severity: Medium, Team: t, Player: p,
			Title:  "Flashing teammates",
			Detail: fmt.Sprintf("%s blinded teammates %d times, %.1f seconds in total.", name, st.TeammatesFlashed, st.TeammateBlindTime),
			Tip:    "Throw flashes that pop before they reach teammates' view, or call them out loud before throwing.",
		}
		in.Moments = a.teamFlashMoments(func(b match.Blind) bool { return b.Attacker == p })
		a.add(in)
	}

	if st.FlashesThrown >= 5 && float64(st.EnemiesFlashed)/float64(st.FlashesThrown) < 0.4 {
		in := Insight{
			ID: "player-flash-quality", Severity: Low, Team: t, Player: p,
			Title:  "Flashes are not catching enemies",
			Detail: fmt.Sprintf("%s threw %d flashes that blinded %d enemies for over a second.", name, st.FlashesThrown, st.EnemiesFlashed),
			Tip:    "Learn a few pop flashes for the positions you usually take. A flash that blinds nobody only tells the enemy you are coming.",
		}
		caught := map[int]bool{}
		for _, b := range m.Blinds {
			if b.Grenade >= 0 && a.enemies(b.Attacker, b.Victim) && float64(b.Duration) >= minBlind {
				caught[b.Grenade] = true
			}
		}
		for _, g := range m.Grenades {
			if g.Thrower == p && g.Type == eqFlash && !caught[g.ID] && g.EffectTick > 0 {
				in.Moments = append(in.Moments, Moment{Round: g.Round, Tick: g.ThrowTick - int(a.rate), Player: p, Label: fmt.Sprintf("%s flash blinded no enemies", rnd(g.Round))})
			}
		}
		a.add(in)
	}

	if a.worstUtilityHoarder(t) == p {
		in := Insight{
			ID: "player-unused-util", Severity: Low, Team: t, Player: p,
			Title:  "Dying with utility",
			Detail: fmt.Sprintf("%s died %d times with grenades left, $%d in total. That is the most on the team.", name, st.DeathsWithUtility, st.UnusedUtilityValue),
		}
		in.Moments = a.unusedUtilMoments(func(k match.Kill) bool { return k.Victim == p })
		a.add(in)
	}

	if st.BlindDeaths >= 3 {
		in := Insight{
			ID: "player-blind-deaths", Severity: Low, Team: t, Player: p,
			Title:  "Dying while flashed",
			Detail: fmt.Sprintf("%s was blind in %d of their deaths.", name, st.BlindDeaths),
			Tip:    "Turn away from incoming flashes and fall back instead of holding the angle blind.",
		}
		for i, k := range m.Kills {
			if k.Victim == p && k.VictimBlind {
				in.Moments = append(in.Moments, a.killMoment(i, fmt.Sprintf("%s died blind to %s", rnd(k.Round), a.name(k.Killer))))
			}
		}
		a.add(in)
	}

	if st.ShotsFired >= 150 && st.Accuracy < 15 {
		a.add(Insight{
			ID: "player-accuracy", Severity: Low, Team: t, Player: p,
			Title:  "Low accuracy",
			Detail: fmt.Sprintf("%s hit %.0f%% of %d shots.", name, st.Accuracy, st.ShotsFired),
			Tip:    "Shorter bursts and stopping before shooting usually help more than aim training.",
		})
	}

	// Aim, compared against everyone in the same demo.
	lobbyXhair := a.lobbyMedian(func(e match.Engagement) float64 { return e.CrosshairErrorDeg }, 0)
	if ai.CrosshairErrorDeg > 0 && lobbyXhair > 0 && ai.CrosshairErrorDeg >= lobbyXhair*1.5 {
		in := Insight{
			ID: "player-crosshair", Severity: Medium, Team: t, Player: p,
			Title: "Crosshair placement",
			Detail: fmt.Sprintf("When an enemy appeared, %s's crosshair was %.1f° away from their head on average. The median in this game was %.1f°.",
				name, ai.CrosshairErrorDeg, lobbyXhair),
			Tip: "Keep the crosshair at head height on the angle an enemy will come from, so a fight needs a small adjustment instead of a flick.",
		}
		var list []match.Engagement
		for _, e := range m.Engagements {
			if e.Attacker == p && e.CrosshairErrorDeg >= 0 {
				list = append(list, e)
			}
		}
		sort.Slice(list, func(i, j int) bool { return list[i].CrosshairErrorDeg > list[j].CrosshairErrorDeg })
		for _, e := range list {
			in.Moments = append(in.Moments, Moment{Round: e.Round, Tick: e.FirstSeenTick - int(2*a.rate), Player: p,
				Label: fmt.Sprintf("%s %.0f° off when %s appeared", rnd(e.Round), e.CrosshairErrorDeg, a.name(e.Victim))})
		}
		a.add(in)
	}

	lobbyReaction := a.lobbyMedian(func(e match.Engagement) float64 { return e.ReactionMs }, 80)
	if ai.ReactionMs > 0 && ai.ReactionSamples >= 5 && lobbyReaction > 0 && ai.ReactionMs >= lobbyReaction*1.3 {
		a.add(Insight{
			ID: "player-reaction", Severity: Low, Team: t, Player: p,
			Title: "Slow to shoot after spotting",
			Detail: fmt.Sprintf("%s took %.0f ms on average from spotting an enemy to the first shot. The median in this game was %.0f ms.",
				name, ai.ReactionMs, lobbyReaction),
			Tip: "Often this is crosshair placement in disguise. A bigger flick needs more time before the shot.",
		})
	}

	if ai.NoShotDeaths >= 5 && pct(ai.NoShotDeaths, ai.DuelsLost) >= 40 {
		in := Insight{
			ID: "player-no-shot", Severity: Low, Team: t, Player: p,
			Title:  "Dying without shooting back",
			Detail: fmt.Sprintf("In %d of %d lost duels %s did not fire a single shot.", ai.NoShotDeaths, ai.DuelsLost, name),
			Tip:    "Usually a sign of being caught from an unexpected angle or while moving between positions. Look at what the player was checking.",
		}
		for _, e := range m.Engagements {
			if e.Attacker == p && e.Died && e.Shots == 0 {
				in.Moments = append(in.Moments, Moment{Round: e.Round, Tick: e.StartTick, Player: p, Label: fmt.Sprintf("%s killed by %s without a shot", rnd(e.Round), a.name(e.Victim))})
			}
		}
		a.add(in)
	}

	// Things going well.
	if st.Rating >= 1.25 {
		a.add(Insight{ID: "player-rating", Severity: Positive, Team: t, Player: p,
			Title:  "Standout performance",
			Detail: fmt.Sprintf("%s finished with a %.2f rating, %d kills and %.0f ADR.", name, st.Rating, st.Kills, st.ADR)})
	}
	if st.ClutchesWon >= 2 {
		a.add(Insight{ID: "player-clutch", Severity: Positive, Team: t, Player: p,
			Title:  "Clutch player",
			Detail: fmt.Sprintf("%s won %d of %d clutch situations.", name, st.ClutchesWon, st.ClutchesPlayed)})
	}
	if st.TradeKills >= 4 && st.Kills > 0 && pct(st.TradeKills, st.Kills) >= 25 {
		a.add(Insight{ID: "player-trader", Severity: Positive, Team: t, Player: p,
			Title:  "Reliable trade partner",
			Detail: fmt.Sprintf("%d of %s's %d kills traded a teammate.", st.TradeKills, name, st.Kills)})
	}
	if st.EnemiesFlashed >= 8 && st.FlashesThrown > 0 && float64(st.EnemiesFlashed)/float64(st.FlashesThrown) >= 1 {
		a.add(Insight{ID: "player-flashes", Severity: Positive, Team: t, Player: p,
			Title:  "Effective flashes",
			Detail: fmt.Sprintf("%s blinded %d enemies with %d flashes (%d flash assists).", name, st.EnemiesFlashed, st.FlashesThrown, st.FlashAssists)})
	}
}

func buyName(b string) string {
	switch b {
	case "eco":
		return "an eco"
	case "force":
		return "a force buy"
	case "full":
		return "a full buy"
	}
	return "a " + b
}

// worstUtilityHoarder returns the player on team t who wasted the most
// grenades, or -1 if nobody stands out.
func (a *analyzer) worstUtilityHoarder(t int) int {
	best, total, n := -1, 0, 0
	for _, st := range a.r.Players {
		if a.teamOf(st.Player) != t || st.Rounds < 5 {
			continue
		}
		total += st.UnusedUtilityValue
		n++
		if best < 0 || st.UnusedUtilityValue > a.r.Players[best].UnusedUtilityValue {
			best = st.Player
		}
	}
	if best < 0 || n == 0 {
		return -1
	}
	v := a.r.Players[best].UnusedUtilityValue
	if v < 3000 || float64(v) < 1.25*float64(total)/float64(n) {
		return -1
	}
	return best
}
