# Zijinshan WorkBuddy Acquisition Batch — 2026-08-16

Status: READY_TO_DISPATCH
Area: `AREA-NJ-ZIJINSHAN`
Priority: P0/P1

## Frozen acquisition rules

- Accuracy/provenance > completeness.
- Track != Route.
- Planned/navigation line != Recorded GPS.
- Do not POI-stitch geometry.
- Same name/endpoints != same child Route.
- Duplicate/reposted track is not independent evidence.
- Popularity never overrides Rule/Legal truth.
- Current official Rule beats old UGC for legality/access.
- UGC closure is Observation/Runtime candidate, not official Rule.
- Unknown stays Unknown.
- Synthetic/demo data must never enter production evidence.
- S12-A: no manual track download request without D2 public spatial pre-verification.
- Repeated target misses are evidence; stop a source class instead of repeatedly downloading title/location matches.

## Known canonical baseline — do not rediscover as new evidence

- `ZJ-S12-RF`: 紫金山南麓绿道轻徒步 — CANONICAL_FAMILY.
- `ZJ-S12-A`: 下马坊驿站 → 民国邮政博物馆 → 南京地震科学馆 → 流徽榭. Identity CANONICAL; Geometry GEOMETRY_BLOCKED / EXTERNAL_DEPENDENCY.
- Rejected S12-A raw candidates: `42160328`, `45517618`, `52046317`.
- `event4731986` / 紫金山游园线 = PLANNED_NAVIGATION_LINE / CONTROL_ONLY.
- No validated genuine S12-B Recorded GPS exists yet.

## Official evidence newly reconfirmed 2026-08-16

### O-2026-TRAFFIC-01
Source: 南京市中山陵园管理局，2026-07 proposal response
URL: https://zschina.nanjing.gov.cn/zfxxgk/zfxxgkml/202607/t20260713_5875566.html
Claims to capture:
- 2025-10-01 traffic optimization remains implemented.
- Weekdays 09:00-17:00; weekends/holidays 08:30-17:30 differentiated traffic control.
- 陵园路（梅花谷路至四方城东路）常态化步行道管理.
- Multiple roads use motor-vehicle reservation/reporting controls.
- Taxi/ride-hailing access restricted in controlled periods.
Evidence class: RuleEvidence / AccessEvidence.

### O-2026-ACCESS-01
Source: 2026 春假+清明服务指南
URL: https://zschina.nanjing.gov.cn/lyzx/202604/t20260401_5816920.html
Claims to capture:
- Two outer hubs: 金陵style, 紫金·钟爱里.
- Four metro aggregation entrances: 苜蓿园, 下马坊, 孝陵卫, 钟灵街.
- Self-driving visitors recommended to park at outer hubs and transfer.
Evidence class: AccessEvidence.

### O-2025-PARK-RULE-01
Source: 自驾停车预约、景区接驳提示
URL: https://zschina.nanjing.gov.cn/fjms/fwzn/zjxl/202303/t20230328_3873325.html
Claims to capture:
- Since 2025-10-01: limited reservation parking.
- Eligible: medium/small/micro passenger cars, excluding taxis/ride-hailing.
- Reserve one day in advance.
- Max 2 reservations per vehicle per natural month.
Evidence class: RuleEvidence / Parking policy.

### O-2025-PARK-FEE-01
Source: Zhongshan Mountain National Park Tour Guide
URL: https://zschina.nanjing.gov.cn/lyzx/202506/t20250623_5591074.html
Claims to capture:
- Official core/peripheral parking fee policy by vehicle class, day/overnight, holiday/weekend/weekday.
Important: this is a fee-class policy. Do NOT assign a fee to an individual parking lot until that lot's core/peripheral and timed/flat-rate classification is evidenced.
Evidence class: Parking pricing policy.

### O-2026-HOURS-01
Source: 2026-06 service guide
URL: https://zschina.nanjing.gov.cn/lyzx/202606/t20260618_5862979.html
Claims to capture only with temporal scope:
- 中山陵陵寝 08:30-17:00.
- 明孝陵/灵谷/音乐台 ticketing 06:30-18:30 in that notice period.
- 白马公园 06:00-22:00 in that notice period.
Important: do not generalize holiday/special-event hours into timeless Area-wide hours.
Evidence class: RuleEvidence / ManagedComponent hours.

### O-2023-GREENWAY-01
Source: 南京环紫金山绿道平面图及沿线景点介绍
URL: https://zschina.nanjing.gov.cn/fjms/fwzn/ldxl/
Claims:
- Greenway planned total length ~25 km.
- Official semantic routes: ecology / culture / family.
- S12-family nodes include 下马坊、民国邮政博物馆、南京地震科学馆、流徽榭 in the official greenway network.
Important: reference/semantic evidence only; never trace the map or POI-stitch into canonical Route geometry.

---

# WorkBuddy tasks

## WB-ZJ-P0-01 — Parking lot-level materialization

Goal: turn generic official parking policy into lot-specific Parking entities without guessing.

Target lots/hubs, at minimum:
- 金陵style
- 紫金·钟爱里
- 中山陵停车场
- 明孝陵停车场 / 明孝陵1号门周边停车
- 梅花谷停车场
- 音乐台停车场
- 紫金山索道停车场
- 马群换乘中心
- 龙湖紫金MALL
- 南理工科技创新园
- 钟鼎名悦广场

For each lot collect:
- canonical_name
- aliases
- coordinates/map share link
- operator/manager
- core_or_peripheral classification
- timed_or_flat_rate classification
- capacity (car/bus/EV if separately published)
- current fee board or official fee page
- reservation_required / reservation_channel
- operating hours
- EV charging
- accessible parking
- source URL
- source type
- published/observed date
- screenshot filename
- exact quoted claim <= 25 words
- confidence

Hard rule: if fee class cannot be bound to the individual lot, return `fee_state=POLICY_KNOWN_LOT_CLASS_UNKNOWN`, not an inferred price.

Priority source order:
1. 景区/政府 official pages
2. official WeChat/service mini-program UI screenshots
3. 南京停车/宁停车 official UI
4. operator page/onsite board photo
5. map platforms only for location/alias discovery, not price truth

Output: `workbuddy_zj_parking_lot_matrix.csv` + screenshots folder + `source_index.json`.

## WB-ZJ-P0-02 — Current trailhead / access-point matrix

Goal: materialize true hiking AccessPoints, not just tourist entrances.

Targets:
- 蒋王庙地铁/蒋王庙上山口
- 范鸿仙墓入口
- 白马公园登山入口
- 太平门/索道下站周边入口
- 樱驼村/板仓街北麓入口候选
- 下马坊/孝陵卫/钟灵街 as transit-linked access nodes
- any other repeatedly used hiking trailhead found >=3 independent current sources

For each:
- access_point_id candidate
- exact name / alias
- lat/lon or map pin
- pedestrian access
- transit link
- parking link
- gate/fence presence
- official opening restriction if any
- night-access evidence
- current construction/closure evidence
- trail connection semantic
- source and date

Do NOT infer legal night access from people hiking at night. UGC night use = Observation only.

Output: `workbuddy_zj_access_points.csv`.

## WB-ZJ-P0-03 — Current Route discovery: recent high-volume candidates

Goal: identify Route/RouteFamily candidates from Chinese user platforms while preserving Track != Route.

Platforms:
- 两步路
- 六只脚
- 小红书
- 抖音
- 微信公众号/活动报名 pages
- 百度/高德 public share pages where available

Time priority: 2025-01-01 to present; second priority 2024.

Queries must combine different intent dimensions, not only “紫金山徒步”:
- 紫金山 徒步 环线
- 紫金山 新手 徒步
- 紫金山 半日 徒步
- 紫金山 夜爬 / 夜徒
- 紫金山 亲子 徒步
- 紫金山 越野 / 穿越
- 蒋王庙 头陀岭
- 范鸿仙墓 头陀岭 蒋王庙
- 白马公园 头陀岭
- 下马坊 流徽榭 绿道
- 紫金山 平路 绿道
- 紫金山 地铁出发 徒步

For every candidate capture:
- platform
- native_id
- URL/share link
- title
- author/account
- publish/activity date
- route name as written
- start/end
- ordered named nodes
- reported distance/elevation/time
- loop/P2P/return
- download/save/like/comment counts where visible
- track_downloadable? yes/no
- geometry_publicly_viewable? yes/no
- original GPS claim? yes/no/unknown
- duplicate/repost suspicion
- RouteFamily hypothesis
- child Route hypothesis
- evidence role: DISCOVERY_ONLY / SEMANTIC / POPULARITY / RAW_CANDIDATE

Do not download every track. Only promote to manual/download queue after public spatial D2 pre-verification.

Output: `workbuddy_zj_route_candidate_catalog.csv`.

## WB-ZJ-P0-04 — S12-B geometry dependency attack

Target sibling semantics:
下马坊地铁2口 → T80 → 紫金山绿道 → 陵园邮局 → 茶园/绿野茶屋 → 流徽榭 → Welope

Goal: find an original recorded activity/track share, not another narrative post.

Search:
- 小红书 original author / route share
- 抖音 original post and profile links
- 两步路 / 六只脚 matching ordered nodes
- route-planning/app outbound share links
- comments/screenshots that reveal native activity ID

Acceptance before download request:
- public map/preview visibly crosses at least 3 target anchors in correct order, OR
- original activity app exposes a route polyline/track preview sufficient for spatial pre-check.

If only title/distance/start-end matches: HOLD, no download request.
If original activity is app-private: return `EXTERNAL_APP_SHARE_DEPENDENCY` plus exact app/native ID/account/post URL.

Output: `workbuddy_zj_s12b_dependency_report.json`.

## WB-ZJ-P1-01 — Route001/Route002 current popularity and semantics

Targets:
- ROUTE-NJ-ZJ-001 蒋王庙—头陀岭—蒋王庙
- ROUTE-NJ-ZJ-002 范鸿仙墓—头陀岭—蒋王庙

Goal: enrich PopularityEvidence and SemanticEvidence without altering canonical geometry.

Collect 2024-present:
- exact/synonym route mentions
- start/end wording
- common intermediate nodes
- difficulty language
- expected duration
- crowd level / seasons
- night use mentions
- dogs/children/elderly mentions
- safety/road-surface descriptions
- platform engagement metrics

For soft attributes return observed counts + contradictory examples; do not collapse directly into Canonical Rule truth.

Output: `workbuddy_zj_route001_002_semantics.csv`.

## WB-ZJ-P1-02 — Current condition/runtime snapshot

Goal: current operational snapshot only; never static truth.

Check current dated notices/posts for:
- temporary closures
- construction / trail work
- forest fire restrictions
- extreme-weather closure
- cableway maintenance
- event traffic controls
- component-hour temporary changes

For every item:
- scope_type
- scope_entity
- observed_at/published_at
- valid_from/valid_until if explicit
- closure_state
- source_authority
- URL
- evidence class

If expiry is not stated, mark `valid_until=UNKNOWN`; do not invent a freshness horizon in source data.

Output: `workbuddy_zj_runtime_snapshot_2026-08-16.json`.

---

# Required WorkBuddy return package

Return one ZIP with:

```text
zijinshan_workbuddy_batch_2026-08-16/
  source_index.json
  workbuddy_zj_parking_lot_matrix.csv
  workbuddy_zj_access_points.csv
  workbuddy_zj_route_candidate_catalog.csv
  workbuddy_zj_s12b_dependency_report.json
  workbuddy_zj_route001_002_semantics.csv
  workbuddy_zj_runtime_snapshot_2026-08-16.json
  screenshots/
  raw_exports/
  README.md
```

Every row/claim must have `source_url`, `source_type`, `source_date`, and `evidence_role`.

Do not return prose-only summaries as the primary deliverable.
