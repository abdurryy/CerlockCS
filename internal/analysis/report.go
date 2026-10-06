// Package analysis turns a parsed match into stats and a list of concrete
// findings a team can go through in review. Every finding links to the
// moments in the demo it is based on.
package analysis

import "github.com/abdurryy/CerlockCS/internal/match"

type Report struct {
	Players  []PlayerStats `json:"players"`
	Teams    [2]TeamStats  `json:"teams"`
	Rounds   []RoundInfo   `json:"rounds"`
	Insights []Insight     `json:"insights"`
	Aim      []AimSummary  `json:"aim"`
	// TradeWindow is the time in seconds a death counts as traded within.
	TradeWindow float64 `json:"tradeWindow"`
}

type PlayerStats struct {
	Player        int     `json:"player"`
	Rounds        int     `json:"rounds"`
	Kills         int     `json:"kills"`
	Deaths        int     `json:"deaths"`
	Assists       int     `json:"assists"`
	FlashAssists  int     `json:"flashAssists"`
	Headshots     int     `json:"headshots"`
	Damage        int     `json:"damage"`
	ADR           float64 `json:"adr"`
	KAST          float64 `json:"kast"`
	Rating        float64 `json:"rating"`
	UtilityDamage int     `json:"utilityDamage"`

	OpeningKills   int `json:"openingKills"`
	OpeningDeaths  int `json:"openingDeaths"`
	TradeKills     int `json:"tradeKills"`
	TradedDeaths   int `json:"tradedDeaths"`
	UntradedDeaths int `json:"untradedDeaths"`
	IsolatedDeaths int `json:"isolatedDeaths"`
	EarlyDeaths    int `json:"earlyDeaths"`
	BlindDeaths    int `json:"blindDeaths"`

	MultiKills     map[int]int `json:"multiKills"`
	ClutchesPlayed int         `json:"clutchesPlayed"`
	ClutchesWon    int         `json:"clutchesWon"`

	FlashesThrown     int     `json:"flashesThrown"`
	SmokesThrown      int     `json:"smokesThrown"`
	HEThrown          int     `json:"heThrown"`
	MolotovsThrown    int     `json:"molotovsThrown"`
	DecoysThrown      int     `json:"decoysThrown"`
	EnemiesFlashed    int     `json:"enemiesFlashed"`
	EnemyBlindTime    float64 `json:"enemyBlindTime"`
	TeammatesFlashed  int     `json:"teammatesFlashed"`
	TeammateBlindTime float64 `json:"teammateBlindTime"`
	SelfFlashed       int     `json:"selfFlashed"`

	DeathsWithUtility  int `json:"deathsWithUtility"`
	UnusedUtilityValue int `json:"unusedUtilityValue"`

	ShotsFired int     `json:"shotsFired"`
	ShotsHit   int     `json:"shotsHit"`
	Accuracy   float64 `json:"accuracy"`
}

type SideRecord struct {
	Played int `json:"played"`
	Won    int `json:"won"`
}

type TeamStats struct {
	Team   int                    `json:"team"`
	Sides  map[string]*SideRecord `json:"sides"`
	Pistol SideRecord             `json:"pistol"`

	OpeningKills  int `json:"openingKills"`
	OpeningDeaths int `json:"openingDeaths"`
	// Opening duels split by side.
	OpeningBySide map[string]*SideRecord `json:"openingBySide"`

	Deaths       int     `json:"deaths"`
	TradedDeaths int     `json:"tradedDeaths"`
	TradeRate    float64 `json:"tradeRate"`
	// AvgTeammateDistance is the average distance to the closest living
	// teammate at the moment of death.
	AvgTeammateDistance float64 `json:"avgTeammateDistance"`

	// AdvantageRounds are rounds where the team got the first kill.
	AdvantageRounds    SideRecord `json:"advantageRounds"`
	DisadvantageRounds SideRecord `json:"disadvantageRounds"`

	Buys map[string]*SideRecord `json:"buys"`
	// AntiEco counts full buys against an eco or force buy.
	AntiEco SideRecord `json:"antiEco"`

	Plants        SideRecord `json:"plants"`
	Retakes       SideRecord `json:"retakes"`
	GrenadesUsed  int        `json:"grenadesUsed"`
	UtilPerRound  float64    `json:"utilPerRound"`
	TeamFlashes   int        `json:"teamFlashes"`
	TeamBlindTime float64    `json:"teamBlindTime"`
	UnusedUtility int        `json:"unusedUtility"`
	// FirstContact is the average number of seconds into the round of the
	// first damage dealt by either team.
	FirstContact float64 `json:"firstContact"`
}

type RoundInfo struct {
	Round      int       `json:"round"`
	BuyType    [2]string `json:"buyType"`
	EquipValue [2]int    `json:"equipValue"`
	// OpeningKill is an index into Match.Kills, -1 if nobody died.
	OpeningKill int `json:"openingKill"`
	// Traded lists kill indexes that were answered by a trade.
	Traded  []int   `json:"traded"`
	Clutch  *Clutch `json:"clutch,omitempty"`
	Planted bool    `json:"planted"`
	Site    string  `json:"site"`
	// FirstContact is in seconds after freeze time ended, -1 if no damage.
	FirstContact float64 `json:"firstContact"`
}

type Clutch struct {
	Player int  `json:"player"`
	Versus int  `json:"versus"`
	Won    bool `json:"won"`
	Tick   int  `json:"tick"`
}

type Severity string

const (
	High     Severity = "high"
	Medium   Severity = "medium"
	Low      Severity = "low"
	Positive Severity = "positive"
)

type Insight struct {
	ID       string   `json:"id"`
	Severity Severity `json:"severity"`
	// Team is the team the insight is about, Player is -1 for team level
	// findings.
	Team    int      `json:"team"`
	Player  int      `json:"player"`
	Title   string   `json:"title"`
	Detail  string   `json:"detail"`
	Tip     string   `json:"tip,omitempty"`
	Moments []Moment `json:"moments"`
}

type Moment struct {
	Round  int    `json:"round"`
	Tick   int    `json:"tick"`
	Player int    `json:"player"`
	Label  string `json:"label"`
}

type AimSummary struct {
	Player      int `json:"player"`
	Engagements int `json:"engagements"`
	DuelsWon    int `json:"duelsWon"`
	DuelsLost   int `json:"duelsLost"`
	// Medians, -1 when there is not enough data.
	ReactionMs        float64 `json:"reactionMs"`
	CrosshairErrorDeg float64 `json:"crosshairErrorDeg"`
	FirstShotErrorDeg float64 `json:"firstShotErrorDeg"`
	TimeToDamageMs    float64 `json:"timeToDamageMs"`
	// Prefires counts shots fired within 80 ms of the enemy being spotted,
	// which is faster than a human reaction.
	Prefires        int     `json:"prefires"`
	HeadshotRate    float64 `json:"headshotRate"`
	DuelAccuracy    float64 `json:"duelAccuracy"`
	NoShotDeaths    int     `json:"noShotDeaths"`
	ReactionSamples int     `json:"reactionSamples"`
}

func Analyze(m *match.Match) *Report {
	a := newAnalyzer(m)
	a.rounds()
	a.players()
	a.teams()
	a.aim()
	a.insights()
	return a.r
}
