# Changelog

## 2.4.15 — 2026-11-06

- ci: find the open market PR through the API, since gh pr list --head returned nothing
- ci: build the market sync branch on the catalog's main, and check the token first
- docs(market): describe the range switch, the trend line and the export
- docs(readme): drop the mainland mirror install note
- docs(readme): swap the hero for a light-theme preview capture and drop the screenshots section
- docs: recapture every screenshot from the current preview page
- feat(ui): first KPI trend shows daily bars for 7 / 30 days, the 7-day average for longer ranges
- fix(ui): the trend line's end dot stays round instead of looking like a fork
- style(ui): period delta in red when usage grows, green when it falls
- fix(ui): a long period delta no longer overlaps the first KPI number
- fix(ui): put the trend line beside the first KPI number so the five cards share one height and baseline
- docs: cache hit rate definition, how to compare with a console, and the design research behind it
- fix(client): Cache Lens takes the four parts as logged; per-provider hit rate; provider card Today button
- fix(host): count a step as its four disjoint parts, so old logs without totalTokens keep their cache
- docs: describe the time range, and make the Cache Lens docs match the code
- test: cover the time range fixes in the in-repo suite
- fix: switching the time range resets the model chart to that range's default granularity
- chore: ignore the screenshot and playwright-cli scratch folders that preview checks leave in the repo
- fix: small issues from the range review — range switch label, CSV quoting, JSON field names, stale comment
- fix: period delta compares finished days only, and only when the previous period is fully covered
- fix: model chart granularity, clipped first bucket and axis labels under the time range
- fix: the range window variable shadowed the global window, so a finished update never reloaded the page
- feat: page-level time range (7 / 30 / 90 days / all time) with export, trend and period delta
- fix(ui): tooltips follow the mouse again
- docs: regenerate the README images from the sanitized preview
- fix: keep private relay and personal provider names out of public files; use current model names in the preview data
- docs(readme): serve the panel capture from a fresh path so the CDN picks it up
- docs(readme): use a real capture of the preview page as the hero image
- docs(readme): replace the hero shot with a rendered panel mock, drop the anchor bar, center the screenshots
- docs(readme): put the wide heatmap on its own row, pair the two square screenshots
- docs(readme): restructure into centered hero, unified badges, screenshots grid and feature table
- docs: note the CI log artifacts and the auto-filed failure issue
- ci: give each artifact a slash-free name (upload-artifact rejects / in names)
- ci: keep the test log as an artifact and open an issue when the suite fails
- test: cover the identity override file, provider grouping and the registry TTL
- test: add an in-repo node:test suite and fix the bugs it found
- docs(readme): add release / npm / downloads / license / awesome-dsh-plugin badges


## 2.4.14 — 2026-11-05

- docs: drop the Cache Lens screenshot from the README (the overview already shows the page)
- docs: bust the image cache so GitHub renders the new screenshots (camo caches by URL)
- docs: refresh the README, the market description and all four screenshots for the new UI


## 2.4.13 — 2026-11-04

- perf(host): measure the scan phases and raise readSession concurrency to 8
- fix(lens): take uncached input from totals.inputTokens so a subtraction artifact can no longer fake a 100% hit rate
- fix(lens): divide the cache table by input, so the hit rate and the rows can never disagree


## 2.4.12 — 2026-11-04

- docs(findings): correct C-6 — the release workflow is active; the 10 earlier commits simply landed after its last run
- style(ui): center the model chart legend under the plot area
- docs: background freshness, the firstScan field and the refresh button's new meaning (INTERNALS, FINDINGS B-12)
- fix(ui): stop showing "scanning" on every open; only the first full scan shows progress
- feat(host): keep the snapshot fresh in the background and flag only the first full scan
- style(ui): drop the "last 12 months · total" note next to the Token activity title
- docs: FINDINGS.md for the review pass, and README / INTERNALS brought in line with the new page
- chore: drop the unused partsText helper and seven dictionary keys left from the old UI; name the activity window constant after what it is
- fix(ui): the activity window is exactly 53 weeks, and tooltips stay fully on screen
- feat(ui): motion and keyboard details
- feat(ui): Cache Lens and provider split rebuilt; the last of the old styles removed
- feat(ui): model distribution — stacked columns with a shared bucket model and a readable tooltip
- fix: size the model chart axis by the tallest stack, not the tallest single segment
- feat(ui): Token activity — three modes with three different shapes on one shared canvas
- feat(ui): new page shell — theme-derived palette, header, status strip and KPI tiles
- feat(preview): a local preview page that renders the real client.js against built-in data
- fix: inject the stylesheet before first paint, keep it current after hot reload, never pull it from under another instance
- fix: refresh re-fetches at once, retry no longer reloads the whole app, and updates cannot be double-started
- fix: heatmap weeks start on Monday like the model chart, and "cumulative" includes earlier usage
- fix: localise the model chart's monthly labels ("月" was hard-coded, English showed "11月")
- fix: pick the 万/亿 unit after rounding, and keep axis steps at whole tokens
- fix: Cache Lens segments always sum exactly to the total, and all three rows stay
- fix: the 5th model/provider colour was an undefined theme token, and "other models" reused the 3rd colour
- fix: DST-safe calendar arithmetic for the model chart buckets and the heatmap start
- fix: only DeepSeek model ids fold into the Flash/Pro families
- docs(host): the header comment listed two GET routes; there are three routes, two of them POST
- fix(host): refuse a second /update while an in-panel update is running
- fix(host): compute streak day arithmetic in UTC so streaks work west of Greenwich
- fix(host): count an orphaned inherited prefix with its own per-day and provider detail
- docs: give Claude Code full execution authority; owner does the visual acceptance, revert is the safety net
- docs: hand-off brief for the UI rewrite (with self-discovery pass and acceptance criteria)
- feat: remove the page-level range selector; the cumulative card and cache lens are always all-time
- feat: the provider card follows only its own today/all-time toggle, not the page range
- revert: drop the line chart, keep the day/week/month switch on the model chart
- feat: model chart gets its own day/week/month and bar/line switches with a usage and an average line, independent of the page range
- Revert "fix: make the heatmap mode switch change the shape (weekly cells in week/total), and let both tooltips follow the cursor"
- fix: make the heatmap mode switch change the shape (weekly cells in week/total), and let both tooltips follow the cursor
- fix: anchor the model chart tooltip to the cursor and let it follow the pointer
- fix: compute the cache lens headline with the official hit-rate formula (cache / input), display-only rounding stays


## 2.4.11 — 2026-11-03

- ci: sync the marketplace entry description nightly, PR only when it drifts
- fix: keep every card mounted when the selected range has no data (provider split too)
- fix: keep the model chart card when the selected range has no usage


## 2.4.10 — 2026-11-03

- ci: do not fail a release when the npm CDN lags behind the successful publish


## 2.4.9 — 2026-11-02

- fix: never write a BOM into package.json (the DSH loader JSON.parses it and skips the bundle)


## 2.4.8 — 2026-11-02

- fix: the zoomed cache lens showed cache/uncached as its second metric (3979%), use uncached share

## 2.4.7 鈥?2026-11-02

- ci: publish a GitHub release on every real publish so the owner gets exactly one notification


## 2.4.6 鈥?2026-11-02

- fix: fold the unversioned official deepseek-flash alias into the V4.1 Flash family


## 2.4.5 鈥?2026-11-02

- ci: decide the version at release time and tag each release instead of bumping per change
- style: rename the provider card, left-align its title, and stretch the model card to match the row, 2.4.4
- fix: split model families by version and tier (v4 flash vs v4.1 flash), 2.4.3
- fix: group model ids into flash/pro families instead of per-variant bars, 2.4.2
- feat: page-level time range driving KPI, cache lens, model and provider splits, 2.4.1
- feat: replace the token-mix donut with a Cache Lens and derive uncached input from the total, 2.4.0


## 2.4.4 鈥?2026-11-02

- 銆屼緵搴斿晢鎷嗗垎銆嶆敼鍚嶄负銆屼緵搴斿晢鍒嗙被銆嶏紝鏍囬鍥炲埌鍗＄墖宸︿笂瑙掞紙鍙充笂鏄粖鏃?绱寮€鍏筹級銆?- 妯″瀷鍒嗗竷鍗＄墖涓庡彸渚ф爮搴曢儴瀵归綈锛氫袱鏍忔敼涓虹瓑楂樻媺浼革紝鍥惧尯鍗犵敤鍓╀綑楂樺害锛屼笉鍐嶅湪鍗＄墖涓嬫柟鐣欑┖鐧姐€?
## 2.4.3 鈥?2026-11-02

- 妯″瀷瀹舵棌鎸?*鐗堟湰 + 妗ｄ綅**褰掑苟锛堢増鏈彿浠ｈ〃妯″瀷鑳藉姏锛屼笉鍚岀増鏈笉娣蜂负涓€璋堬級锛?  `deepseek-v4-1-flash-261017` / `deepseek-v4.1-flash` / `deepseek-v4.1-flash-economy` 鈫?**DeepSeek V4.1 Flash**锛?  `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 鈫?**DeepSeek V4 Flash**锛沗deepseek-v4-pro` 鈫?**DeepSeek V4 Pro**锛?  鏃犵増鏈彿鐨?`deepseek-flash` 鍗曠嫭鎴愬鏃忥紱鍏朵粬鍘傚晢妯″瀷淇濈暀鍚勮嚜鍚嶇О銆?
## 2.4.2 鈥?2026-11-02

- 妯″瀷鍒嗗竷鎸?*鍨嬪彿瀹舵棌**褰掑苟锛歞eepseek-v4-flash / deepseek-v4-1-flash / deepseek-flash / -flash-economy / -flash-vision 鍏ㄩ儴鍚堝苟涓?**DeepSeek Flash**锛屽甫 pro 鐨勫悎骞朵负 **DeepSeek Pro**锛涘叾浠栧巶鍟嗘ā鍨嬩繚鐣欏悇鑷悕绉般€備笉鍐嶅洜涓轰緵搴斿晢鍐欐硶涓嶅悓鑰屾媶鎴愬鏍规煴瀛愩€?
## 2.4.1 鈥?2026-11-02

- 鏂板**椤甸潰绾ф椂闂磋寖鍥?*锛堝叏閮?/ 浠婃棩 / 7 澶?/ 30 澶╋紝浣嶄簬澶撮儴宸ュ叿鏍忥級锛氶┍鍔?KPI 绱 Token銆丆ache Lens銆佹ā鍨嬪垎甯冦€佷緵搴斿晢鎷嗗垎锛涙ā鍨嬪垎甯冧笉鍐嶈嚜甯﹁寖鍥村紑鍏筹紝璺熼殢椤甸潰鑼冨洿銆傜儹鍔涘浘涓庛€屾渶闀夸换鍔?/ 杩炵画澶╂暟銆嶄繚鎸佸師涔変笉鍙樸€?
## 2.4.0 鈥?2026-11-02

- **Token 鏋勬垚鏀逛负 Cache Lens**锛堟浛鎹㈠師鐜舰鍥撅級锛氶《閮ㄤ袱涓ぇ鍙锋寚鏍囷紙鎬?Token / 缂撳瓨鍗犳瘮锛夈€佹í鍚戝垎娈靛崰姣旀潯
  锛堢紦瀛樺懡涓?/ 鏈紦瀛樿緭鍏?/ 杈撳嚭锛夈€佷笁琛屾槑缁嗭紙鑹叉爣 + 鍚嶇О + 鐢ㄩ噺 + 鍗犳瘮锛夈€佸簳閮ㄣ€屾斁澶ч潪缂撳瓨缁嗗垎銆嶆寜閽紱
  鏀惧ぇ鍚庢爣棰樺彉銆岄潪缂撳瓨 Token 鏋勬垚銆嶃€佸垎姣嶆敼涓洪潪缂撳瓨鍚堣骞舵樉寮忔爣娉紝鍙€岃繑鍥炴暣浣撴瀯鎴愩€嶃€傚垏妗?260ms 杩囨浮锛?  hover 鑱斿姩楂樹寒鍒嗘涓庢槑缁嗗苟缁欐诞灞傦紝鏀寔閿洏鐒︾偣锛宍prefers-reduced-motion` 涓嬪叧闂繃娓°€?- **淇缁熻鍙ｅ緞**锛氫笉鍚屼緵搴斿晢鐨?`usage.inputTokens` 璇箟涓嶄竴鑷达紙鏈夌殑宸插惈缂撳瓨鍛戒腑锛夛紝瀹炴祴
  `input + cache + output` 姣?total 澶氬嚭 1.6%銆傜幇鍦ㄤ互 total 涓哄噯鍙嶆帹
  `鏈紦瀛樿緭鍏?= total 鈭?缂撳瓨 鈭?杈撳嚭`锛堝苟澶瑰埌 鈮?0锛夛紝淇濊瘉涓夋浜掓枼銆佸悎璁℃亽绛変簬 total銆?
## 2.3.7 鈥?2026-11-02

- 鍙戝竷鎼埌 GitHub Actions锛歚.github/workflows/publish-pending.yml` 姣?4 灏忔椂妫€鏌ヤ竴娆★紝
  鏈湴鐗堟湰棰嗗厛 npm latest 鏃舵墠鍙戝竷锛堝厛 `node --check`锛屽彂甯冨悗杞 registry 纭鐢熸晥锛夈€傛湰鏈鸿鍒掍换鍔′繚鐣欎负鍏滃簳銆?
## 2.3.6 鈥?2026-11-02

- 鍙戝竷娴佺▼鏀逛负**鏀掓壒**锛氭敼鍔ㄥ彧鍋氭祴璇?+ 鍗囩増鏈?+ CHANGELOG + 鎻愪氦锛宯pm 鍙戝竷鐢?	ools/publish-pending.ps1 姣?4 灏忔椂鎵归噺鎵ц锛堟湰鍦扮増鏈鍏堢嚎涓婃墠鍙戯紝鍙戝竷鍓嶈窇娴嬭瘯锛夈€?
## 2.3.5 鈥?2026-11-02

- Token 鏋勬垚鐨勫浘渚嬶紙杈撳叆 / 杈撳嚭 / 缂撳瓨鍛戒腑锛夊湪鍗＄墖鍐呮按骞冲眳涓€?
## 2.3.4 鈥?2026-11-02

- Token 鏋勬垚鍗＄墖鏀逛负绾靛悜锛氭爣棰樺湪鍗＄墖宸︿笂瑙掞紝鐜舰鍥句笌鍥句緥鍦ㄤ笅鏂癸紙鍥句緥閾烘弧鍗＄墖瀹藉害锛夛紝涓嶅啀涓庢爣棰樺苟鎺掋€?
## 2.3.3 鈥?2026-11-02

- 绉婚櫎銆屾洿鏂颁簬 鈥︺€嶆椂闂存樉绀猴紙杩炲悓鍏惰绠椾笌鏍峰紡锛夛紝椤佃剼涓€骞跺垹闄わ紱鏇存柊鎸夐挳绉诲埌澶撮儴宸ュ叿鏍忥紙浠呭湪鏈夋柊鐗堟湰鏃跺嚭鐜帮級銆?
## 2.3.2 鈥?2026-11-02

- 鎶娿€屾洿鏂颁簬 鈥︺€嶄粠椤甸潰鏈€搴曢儴绉诲埌澶撮儴閭ｄ竴琛岀殑鏈€宸︿晶锛堜笌鍙充笂瑙掑埛鏂版寜閽悓涓€琛岋級锛岄〉鑴氬彧鍓╂洿鏂版寜閽€?
## 2.3.1 鈥?2026-11-02

- Token 娲诲姩鐑姏鍥炬敼涓?*鐙崰鏁磋銆佹寜鍗＄墖瀹藉害鑷€傚簲**锛氭牸瀛愰殢瀹藉害绛夋瘮缂╂斁锛堟鏂瑰舰锛夛紝涓嶅啀鍑虹幇妯悜婊氬姩鏉★紱鏈堜唤鏍囩鏀圭敤鐧惧垎姣斿畾浣嶃€?- 涓讳綋甯冨眬璋冩暣涓恒€岀儹鍔涘浘鏁磋 / 妯″瀷鍒嗗竷 +锛圱oken 鏋勬垚銆佷緵搴斿晢鎷嗗垎 绔栨帓锛夈€嶏紝涓ゆ爮楂樺害鏇存帴杩戯紝涓嶅啀鐣欏ぇ鐗囩┖鐧姐€?
## 2.3.0 鈥?2026-11-02

- 鎸夎璁″浘閲嶆瀯鐣岄潰锛圱oken 娲诲姩鐑姏鍥句繚鎸佷笉鍙橈級锛?  - 澶撮儴鏀逛负銆屽乏澶村儚鏂规爣 + 鍚嶅瓧/璐﹀彿锛屽彸鍒锋柊鎸夐挳銆嶏紱
  - KPI 鏀逛负 5 寮犲甫鍥炬爣寰界珷鐨勫崱鐗囷紝鏁板€?28px锛岄寮狅紙绱 Token锛夋弿杈归珮浜紱
  - 涓讳綋鏀规垚涓ゆ爮缃戞牸锛氫笂鎺掋€孴oken 娲诲姩 + Token 鏋勬垚銆嶏紝涓嬫帓銆屾ā鍨嬪垎甯?+ 渚涘簲鍟嗘媶鍒嗐€嶏紝绐勫睆鑷姩鍫嗗彔锛?  - 鐜舰鍥句腑蹇冩樉绀烘€婚噺涓庛€屾€?Token銆嶏紝鏍囬绉昏繘鍗＄墖鍐咃紱
  - 渚涘簲鍟嗘媶鍒嗘敼涓恒€屽悕绉?/ 鐢ㄩ噺 / 鍗犳瘮銆嶄竴琛?+ 鍦嗚杩涘害鏉★紝鏍囬涔熺Щ杩涘崱鐗囧唴锛?  - 椤佃剼鍙繚鐣欐洿鏂版椂闂翠笌鏇存柊鎸夐挳锛堝埛鏂版寜閽Щ鍒板彸涓婅锛夈€?
## 2.2.0 鈥?2026-11-02

- 妯″瀷鏌辩姸鍥惧姞鍏ュ満鍔ㄧ敾锛氭墦寮€涓汉涓婚〉鏃舵煴瀛愪粠搴曢儴 0 楂樺害鍚戜笂鐢熼暱锛坰caleY + 搴曡竟鍘熺偣锛?80ms 缂撳嚭锛夛紝鎸夋《椤哄簭閿欏紑 18ms锛沺refers-reduced-motion 涓嬭嚜鍔ㄥ叧闂€?- 鍒囨崲銆岃繎 14 澶?/ 鍏ㄩ儴銆嶆椂鍔ㄧ敾浼氶噸鎾竴娆★紙鐢ㄤ簬鎸囩ず鍥捐〃宸叉崲鏁版嵁锛夈€?
## 2.1.0 鈥?2026-11-01

- 妯″瀷鍒嗗竷鏀逛负**鍫嗗彔鏌?*锛氭瘡涓椂闂存《涓€鏍规煴锛屾煴鍐呮寜妯″瀷鍒嗘鐫€鑹诧紙鐢ㄩ噺鍓?6 鐨勬ā鍨嬪悇涓€娈碉紝鍏朵綑鍚堟垚銆屽叾浠栨ā鍨?(N)銆嶄竴娈碉級锛屾ā鍨嬪啀澶氫篃涓嶄細鎸ゃ€?- 鍥句緥淇濈暀姣忎釜绯诲垪鑷繁鐨勭敤閲忥紝棰滆壊鎵╁埌 6 鑹诧紱娈典笂甯﹀師鐢?tooltip锛堟ā鍨嬪悕 + 璇ユ《鐢ㄩ噺锛夈€?
## 2.0.0 鈥?2026-11-01

- **妯″瀷缁熻鏀逛负鍔ㄦ€佽瘑鍒?*锛氫笉鍐嶅啓姝?Flash / Pro 涓ょ被锛岃€屾槸鎶婃瘡涓€姝?`message.source.model` 褰掍竴鍖栧悗鎸夌湡瀹炴ā鍨嬫棌缁熻
  锛堝幓鍘傚晢鍓嶇紑銆佺偣/涓嬪垝绾跨粺涓€銆佸墺鎺?`-1017` / `-261017` / `-20241022` / `-latest` 涔嬬被鐨勫揩鐓у悗缂€锛夛紝
  鎵€浠ヤ腑杞珯鎻愪緵鐨勫叾浠栨ā鍨嬶紙claude / gpt / qwen / glm 鈥︼級涔熶細琚粺璁″埌锛屼笉鍐嶈惤杩涖€屽叾浠栥€嶉粦绠便€?- 闈㈡澘鏄剧ず閫昏緫锛氳寖鍥村唴鐢ㄩ噺鍓?2 鐨勬ā鍨嬪悇鍗犱竴鏍规煴锛屽叾浣欒仛鍚堟垚銆屽叾浠栨ā鍨?(N)銆嶄竴鏍规煴锛涘浘渚嬬粰鍑烘瘡涓郴鍒楃殑**鑷韩鐢ㄩ噺**锛?  鍗＄墖澶撮儴鏍囨槑銆屾€昏 X銆嶃€傛ā鍨嬪悕鐢?id 鑷姩缇庡寲锛坄deepseek-v4-1-flash` 鈫?`DeepSeek V4.1 Flash`锛夈€?- 缂撳瓨缁撴瀯鐗堟湰 10 鈫?11锛屽崌绾у悗棣栨鎵撳紑浼氶噸鎵竴娆★紙绾?2 绉掞級銆?
## 1.9.9 鈥?2026-11-01

- 妯″瀷楗煎浘鍙ｅ緞璇存竻锛氬崱鐗囧ご閮ㄦ敼涓恒€屾€昏 X銆嶏紝鍥句緥閲屾瘡涓ā鍨嬪悕鍚庨潰鐩存帴璺熷畠鑷繁鐨勭敤閲忥紙姝ゅ墠澶撮儴鍙湁涓€涓８鏁板瓧锛岀湅涓嶅嚭鏄€婚噺杩樻槸鏌愪釜妯″瀷锛夈€?
## 1.9.8 鈥?2026-11-01

- README 澶у箙绮剧畝锛堢害 200 琛?鈫?20 琛岋級锛氬彧淇濈暀銆岃兘鍋氫粈涔?/ 鎬庝箞瑁呫€嶏紝涓嫳鍚勪竴鐗堬紱
  鍙ｅ緞瀹氫箟銆佹暟鎹祦銆佽仈缃戣寖鍥淬€佹洿鏂颁笌鎺掗殰缁嗚妭绉诲叆 `docs/INTERNALS.md`锛孯EADME 搴曢儴涓€琛岄摼鎺ャ€?
## 1.9.7 鈥?2026-11-01

- README 绮剧畝锛氬彧淇濈暀涓€寮犳暣椤垫埅鍥撅紝鍒犳帀鏋勬垚/妯″瀷/鐑姏鍥?渚涘簲鍟嗛偅缁勫洓瀹牸锛堜俊鎭噸澶嶏級銆傛埅鍥炬枃浠朵粛鐣欏湪 `docs/` 缁欏競鍦哄崱鐗囩敤銆?
## 1.9.6 鈥?2026-11-01

- 淇鐑姏鍥俱€屾瘡鍛?/ 绱銆嶄袱妗ｇ殑鏁村垪鐫€鑹诧細姝ゅ墠鏈懆鏈€鍚庡嚑澶╄褰撲綔鏈潵鏃ユ湡鐣欑櫧锛屽鑷村悓涓€鍒楅鑹蹭笉榻愩€傜幇鍦ㄥ彧鏈夈€屾瘡澶┿€嶆。灏婇噸鏈潵鏃ユ湡锛屽懆/绱涓ゆ。鏁村垪鍚岃壊銆?
## 1.9.5 鈥?2026-11-01

- README 閲嶅啓锛氭柊澧炵晫闈㈡埅鍥撅紙鏁撮〉 + 鏋勬垚 / 妯″瀷鍒嗗竷 / 鐑姏鍥?/ 渚涘簲鍟嗗洓涓尯鍧楋級锛屾媶鍑哄畬鏁翠腑鏂囩増 `README.zh.md`锛堣嫳鏂囩増甯﹀姩鐢诲垏鎹㈤摼鎺ワ級銆?- 淇鏂囨。閲屼袱澶勫け鏁堝崰浣嶏紙`$DSH_HOME`銆乣$env:NPM_TOKEN` 琚棭鍓嶈剼鏈悆鎺夛級锛屽苟鎶娿€屼笉鑱旂綉銆嶆敼涓哄噯纭姭闇诧細鍞竴澶栧彂鏄瘡 6 灏忔椂璇讳竴娆?npm 涓婄殑鑷韩鐗堟湰鍙枫€?- `files` 鐧藉悕鍗曡ˉ涓?`README.zh.md`锛堟埅鍥句笉杩涘寘锛孯EADME 鐢?CDN 缁濆鍦板潃锛夈€?
## 1.9.4 鈥?2026-10-31

- 妯″瀷鏌辩姸鍥剧殑绾佃酱鏀逛负**鏁撮綈鍗曚綅**锛氭闀挎寜 1 / 2 / 2.5 / 5 脳 10鈦?閫夊彇锛堝鏈€澶?3.4 浜?鈫?姣忔牸 1 浜匡紝鍒诲害 0 / 1 浜?/ 2 浜?/ 3 浜?/ 4 浜匡級锛岃酱椤跺悜涓婂彇鏁村埌姝ラ暱鏁存暟鍊嶏紝鏌卞瓙鎸夎酱椤剁缉鏀俱€?- 鍒诲害鏂囨鍘绘帀澶氫綑鐨?.0锛?.0 浜?鈫?1 浜匡級銆?
## 1.9.3 鈥?2026-10-31

- 淇鏌卞瓙鍩虹嚎涓嶄竴鑷达細鏌卞尯瀹瑰櫒鐢?`flex: 1 1 auto` 瀵艰嚧姣忎釜妗堕珮搴︿笉鍚岋紙鏌卞瓙楂樺害鏄櫨鍒嗘瘮锛屽熀绾垮氨姝簡锛夛紝鏀逛负 `flex: 1 1 0`锛屾墍鏈夋《绛夐珮銆?- 鏌卞瓙鍙樼粏锛堟渶瀹?16px 骞跺眳涓級锛岃繎 14 澶╄兘瀹屾暣鏀句笅锛涙í杞存爣绛炬娊绋€涓婇檺浠?8 鎻愬埌 14锛?4 澶╂瘡澶╅兘鏄剧ず鏃ユ湡銆?
## 1.9.2 鈥?2026-10-31

- 妯″瀷鍒嗗竷鎸夊弬鑰冨浘閲嶆帓锛氭爣棰樹笌銆屾€昏銆嶇Щ杩涘崱鐗囧ご閮紙鍙充晶浠嶆槸鑼冨洿鍒囨崲锛夛紱閲忕骇鏁板瓧璐村湪缃戞牸绾垮乏渚с€佺綉鏍肩嚎鏁村绌胯繃锛涙煴瀛愬姞瀹斤紙鍗曞簭鍒楁椂濉弧妗跺锛夛紱鍥句緥灞呬腑鏀惧湪鍥句笅鏂广€?
## 1.9.1 鈥?2026-10-31

- 淇妯″瀷鏌辩姸鍥剧殑妯酱鏃ユ湡娑堝け锛?.8.0 缁欐煴鍖哄姞鐨勬í鍚戞粴鍔ㄥ鍣紙overflow-x: auto + overflow-y: hidden锛夋妸鍘熸湰缁濆瀹氫綅鍦ㄦ煴瀛愪笅鏂圭殑鏃ユ湡鏍囩瑁佹帀浜嗐€傜幇鍦ㄦ爣绛炬敼涓烘煴浣撳垪鍐呯殑鍥哄畾 16px 鎺掔増琛岋紝鍒诲害绾垮崟鐙竴灞傚彧瑕嗙洊鏌卞尯锛屾粴鍔ㄦ椂鏍囩闅忔煴瀛愪竴璧风Щ鍔ㄣ€?
## 1.9.0 鈥?2026-10-31

- KPI 绗簩寮犲崱鐢便€孴oken 浣跨敤宄板€笺€嶆敼涓?*浠婃棩 Token 鐢ㄩ噺**銆?- 椤哄甫淇銆屼粖鏃ャ€嶅彛寰勶細鍘熸潵鍙栫殑鏄€屾渶鍚庝竴澶╂湁鏁版嵁鐨勮褰曘€嶏紙鍙兘鏄槰澶╂垨鏇存棭锛夛紝鐜板湪涓ユ牸鍙栦粖澶╃殑鏃ユ湡锛涗緵搴斿晢鎷嗗垎鐨勩€屼粖鏃ャ€嶈鍥句篃闅忎箣鍙樺噯銆?
## 1.8.2 鈥?2026-10-31

- Token 鏋勬垚鎺掑竷淇锛氬浘渚嬭涓嶅啀鐢?1fr 鎷変几锛堝師鏉ユ妸鏁板瓧椤跺埌鍗＄墖鏈€鍙宠竟锛屼腑闂寸┖鍑轰竴澶у潡锛夛紝鏀逛负绱у噾瀹氬鍒楀苟瀵归綈鏁板€硷紝鐜舰鍥炬斁澶у埌 148px锛屾暣浣撳眳涓€?
## 1.8.1 鈥?2026-10-31

- 妯″瀷鏌辩姸鍥剧殑閲忕骇鍒诲害浠庡乏绉诲埌**鏈€宸﹀垪**锛堝彸渚т笉鍐嶅帇鍦ㄦ煴瀛愪笂锛夛紝鏌卞尯宸︾Щ璁╁嚭 64px 缁欏埢搴︺€?
## 1.8.0 鈥?2026-10-31

- 淇妯″瀷鍥句緥鍙ｅ緞锛氬悎璁℃敼涓?*褰撳墠鑼冨洿鍐?*鐨勬《涔嬪拰锛岃寖鍥村唴涓?0 鐨勬ā鍨嬩笉鍐嶅嚭鐜板湪鍥句緥涓庢煴瀛愪腑锛堟鍓嶆姤鐨勬槸鍏ㄦ椂娈靛悎璁★紝瀵艰嚧杩?14 澶╀篃鏄剧ず Deepseek-V4-Pro锛夈€?- 淇銆屽叏閮ㄣ€嶈鍥炬煴瀛愭尋鍙狅細鏃堕棿杞存敼涓鸿繛缁紙鏃犳暟鎹殑鏃ユ湡涔熷崰浣嶏級锛屽苟鎸夎寖鍥村垏鎹㈢矑搴︹€斺€旇繎 14 澶╂寜澶┿€佸叏閮ㄦ寜鍛紙鍛ㄤ竴璧风畻锛夋眹鎬伙紱鏌卞瓙鏈€灏忓搴?+ 妯悜婊氬姩锛屾爣绛炬寜妗舵暟鎶界█銆?
## 1.7.0 鈥?2026-10-31

- 妯″瀷鍒嗗竷鏀逛负**鎸夋椂闂寸殑绔栧悜鏌辩姸鍥?*锛氭瘡澶╀竴缁勬煴锛屼袱涓ā鍨嬪垎鑹诧紝宸︿晶铏氱嚎鍒诲害缁欓噺绾э紝鍥句緥缁欐ā鍨嬪悕涓庡悎璁★紝鍒囨崲銆岃繎 14 澶?/ 鍏ㄩ儴銆嶃€?- 妯″瀷鍚嶅啓鎴愬叿浣撳悕绉帮細`Deepseek-V4.1-Flash-1017` 涓?`Deepseek-V4-Pro`銆?- 鎮诞鏌愪釜鏃堕棿妗舵椂鏄剧ず璇ユ棩鍚勬ā鍨嬬殑 token 鐢ㄩ噺锛堟棩鏈?+ 妯″瀷鍚?+ 鐢ㄩ噺锛夈€?
## 1.6.0 鈥?2026-10-31

- 鏂板**妯″瀷鍒嗗竷**锛氭寜 ssistant/message 鐨?message.source.model 褰掔被缁熻锛屾煴鐘跺浘灞曠ず锛屽甫銆屼粖鏃?/ 绱銆嶅垏鎹€?- 鍒嗙被鍙ｅ緞锛氭ā鍨嬪悕鍚?pro 褰?Pro锛屽惈 lash 褰?Flash锛屽叾浣欏綊鍏朵粬锛堝綋鍓嶈鏂欓噷鏄?6 涓?flash 鍙樹綋 + 1 涓?pro锛屾濂戒袱绫伙級銆?- 缁ф壙鍓嶇紑锛坒ork/seed 鎶勮繘鏉ョ殑鍘嗗彶浜嬩欢锛夊悓鏍锋寜妯″瀷璁拌处锛涚紦瀛樼粨鏋勭増鏈?9 鈫?10锛岄娆℃墦寮€浼氶噸鎵竴娆★紙绾?2 绉掞級銆?
## 1.5.1 鈥?2026-10-31

- 鍥炴粴 1.5.0 鐨勭晫闈㈤噸鏋勶紝鎭㈠ 1.4.3 鐨勫師鏈夋牱寮忥紙1.5.0 鐨勬敼鍔ㄤ繚鐣欏湪 `design/achromatic-ledger` 鍒嗘敮锛屾湭涓㈠け锛夈€傚姛鑳芥棤鍙樺寲銆?
## 1.4.3 鈥?2026-10-31

- 淇鍗囩骇缁撴灉璇诲彇鏃跺簭锛氬崌绾х粨鏋滃湪閲嶈瀹屾垚鍚庢墠钀界洏锛屾柊瀹炰緥鎸夐渶琛ヨ `update.json`锛屽揩鐓ч噷鐨?`update.lastResult` 涓嶅啀鎬绘槸 null銆?
## 1.4.2 鈥?2026-10-31

- README 琛ュ厖鑷洿鏂板け璐ョ殑鎭㈠姝ラ锛坮emove 鎴愬姛浣?install 澶辫触鏃舵彃浠朵細娑堝け锛岄渶鍦ㄦ彃浠堕〉閲嶈锛涙暟鎹笉鍙楀奖鍝嶏級銆?
## 1.4.1 鈥?2026-10-31

- 淇鐗堟湰鎺㈡祴锛氭敼鐢?registry 鐨?`/<name>/latest` 璇绘渶鏂扮増锛坄pluginManager.inspect` 瀵瑰凡瀹夎鐨勫寘涓€寰嬭繑鍥?already-installed锛岄棶涓嶅嚭鏂扮増鏈級銆?- 閿欒鐮侀『搴忎慨姝ｏ細鍏堝垽鏂兘鍚︽洿鏂帮紝鍐嶅垽鏂洰鏍囩増鏈紝link/git 瀹夎浼氬緱鍒?`not-registry-install` 鑰屼笉鏄?`no-target`銆?
## 1.4.0 鈥?2026-10-31

- 闈㈡澘鍐呬竴閿崌绾э細瀹夸富姣?6 灏忔椂鐢?`pluginManager.inspect` 鏌ヤ竴娆?npm 涓婄殑 latest锛屾湁鏂扮増鏈椂椤佃剼鍑虹幇銆屾洿鏂板埌 x.y.z銆嶆寜閽紱
  鐐瑰嚮鍚庡涓绘寜 remove 鈫?install 瀹屾垚鍗囩骇锛堝厛绛斿璇锋眰銆佸啀寤惰繜鎵ц锛岄伩鍏嶅湪鑷繁鐨勮皟鐢ㄦ爤閲岀瓑鑷繁鍗歌浇锛夛紝鎻掍欢閲嶈瀹屾垚鍚庨〉闈㈣嚜鍔ㄥ埛鏂般€?- 鍙 **registry 瀹夎**鍚敤锛坄file:/link:/git+/github:/https:` 涓€寰嬩笉鏄剧ず鎸夐挳锛岄伩鍏嶅姩鍒板紑鍙戝壇鏈垨鑷綔涓诲紶鏀瑰畨瑁呮柟寮忥級銆?- 妗岄潰 profile 鏃犳硶鐢?CLI 鎴栫涓夋柟 updater 鏇存柊锛坄profile "desktop" is managed exclusively by the Electron application`锛夛紝鍥犳璇ユ寜閽槸妗岄潰鐢ㄦ埛鐨勫敮涓€涓€閿崌绾ц矾寰勩€?
## 1.3.2 鈥?2026-10-31

- README 澧炶ˉ銆岀敤鎴峰浣曚繚鎸佹渶鏂般€嶏細浠?registry 瀹夎鍙绗笁鏂?updater 妫€娴嬶紱鏇存柊璧板畼鏂?add 閫氶亾锛涢渶閲嶅惎鐢熸晥锛沺npm 11 minimumReleaseAge 鐨勬敞鎰忕偣銆?
## 1.3.1 鈥?2026-10-31

- 绉婚櫎 Token 鏋勬垚涓嬫柟鐨勫彛寰勮鏄庢枃瀛楋紙鐣岄潰涓嶅啀鍑虹幇瑙ｉ噴鎬ф枃妗堬級銆?
## 1.3.0 鈥?2026-10-31

- 棣栨缁熻鏇村揩锛氫細璇濆苟琛岃鍙栵紙4 璺級锛岃仛鍚堟瘡 4 涓細璇濋噸寤轰竴娆★紝涓嶅啀閫愪細璇濇暣琛ㄩ噸寤恒€?- 棣栨缁熻鏈熼棿鍗＄墖鏄剧ず銆屸€斻€嶅苟缁欏嚭 宸茶/鎬绘暟 杩涘害锛屼笉鍐嶆槸涓€灞?0 璁╀汉浠ヤ负娌℃暟鎹€?- Token 鏋勬垚鏀逛负**鐜舰鍥?*锛堣緭鍏?/ 杈撳嚭 / 缂撳瓨鍛戒腑锛夛紝骞惰ˉ涓€琛屽彛寰勮鏄庯細杈撳叆鍙畻鏈懡涓紦瀛樼殑 prompt銆?
## 1.2.2 鈥?2026-10-31

- 鎮诞娴眰绮剧畝锛氫笁妗ｏ紙姣忓ぉ/姣忓懆/绱锛夐兘鍙繚鐣欍€屾椂闂?+ 缂╁啓鐢ㄩ噺銆嶄袱琛岋紝鍘绘帀绮剧‘ token 鏁板瓧涓庤姹傛暟銆?
## 1.2.1 鈥?2026-10-31

- 鐑姏鍥炬偓娴枃妗堜慨姝ｏ細姣忓懆妗ｄ负銆寋鏃ユ湡} 璧风殑涓€鍛ㄣ€嶏紝绱妗ｄ负銆岀疮璁¤嚦 {鏃ユ湡} 璧风殑涓€鍛ㄣ€嶏紝鏃ユ湡涓€寰嬪甫骞翠唤锛堝 2026骞?0鏈?6鏃ワ級銆?
## 1.2.0 鈥?2026-10-31

- Token 娲诲姩鏀寔涓夋。锛?*姣忓ぉ / 姣忓懆 / 绱鎬婚噺**銆傛瘡鍛ㄦ寜鍒楄仛鍚堬紙鏁村垪鍚岃壊锛夛紝绱涓烘埅鑷宠鍛ㄧ殑绱鍊硷紱
  鎮诞鏂囨闅忔。浣嶅彉鍖栵細姣忓ぉ鏄剧ず鏃ユ湡銆佹瘡鍛ㄦ樉绀恒€寋鏃ユ湡} 璧蜂竴鍛ㄣ€嶃€佺疮璁℃樉绀恒€岀疮璁¤嚦 {鏃ユ湡}銆嶏紝涓夋。閮界粰鍑虹缉鍐欏€间笌绮剧‘鏁板瓧銆?
## 1.1.3 鈥?2026-10-31

- README锛氳韩浠界ず渚嬫敼涓洪€氱敤鍗犱綅锛圷our Name / @your-handle锛夛紝骞跺啓鏄庨粯璁ゆ樉绀烘搷浣滅郴缁熻处鎴峰悕銆乸rofile.json 涓嶄細闅忓寘鍒嗗彂銆備粎鏂囨。锛屾棤浠ｇ爜鍙樻洿銆?
## 1.1.2 鈥?2026-10-31

- 淇鐑姏鍥炬湀浠芥爣绛鹃噸鍙狅細绐楀彛璧风偣钀藉湪鏈堟湯鏈€鍚庝竴鍛ㄦ椂锛岃鎴柇鐨勬畫鏈堟爣绛句細鍜屼笅涓€涓暣鏈堟尋鍦ㄤ竴璧凤紱
  鐜板湪鎸夋爣绛句及绠楀搴︽帓甯冿紝璁╀綅缁欏畬鏁存湀浠斤紙鍒楄窛 14px锛岃€屻€?0鏈堛€嶈繖绫绘爣绛剧害 25px 瀹斤級銆?
## 1.1.1 鈥?2026-10-31

- 绮剧畝鐗堝紡锛氬幓鎺夌儹鍔涘浘鐨勩€屽皯/澶氥€嶈壊闃跺浘渚嬶紝鍘绘帀銆屼緵搴斿晢鎷嗗垎銆嶅乏渚х殑鍙ｅ緞璇存槑锛堜粖鏃?绱鍒囨崲淇濈暀锛夈€?
## 1.1.0 鈥?2026-10-31

- 韬唤鍙鐩栵細`$DSH_HOME/dsh-profile-stats/profile.json` 鏀寔 `{"name","handle","avatar"}`锛?  浼樺厛绾т负 profile.json 鈫?绯荤粺璐︽埛鍚?鈫?鍏滃簳鏂囨锛涘揩鐓ч噷鐨?`identity` 澧炲姞 `avatar` / `source` / `file`銆?
## 1.0.0 鈥?2026-10-31

棣栨鍏紑鍙戝竷銆?
- 鏂板銆屼釜浜轰富椤点€嶄晶杈规爮鍏ュ彛涓庝富鍖洪潰鏉匡細绱 Token銆佸崟鏃ュ嘲鍊笺€佹渶闀夸换鍔＄敤鏃躲€佹渶闀胯繛缁ぉ鏁般€佸綋鍓嶈繛缁ぉ鏁般€?- Token 鏋勬垚锛堣緭鍏?/ 杈撳嚭 / 缂撳瓨鍛戒腑锛変笌杩?12 涓湀 Token 娲诲姩鐑姏鍥撅紙鎸夊綋鏃ョ敤閲忓洓鍒嗕綅鍒嗘。锛夈€?- 鐑姏鍥炬偓娴彁绀猴細鏃ユ湡銆佸綋澶╃敤閲忋€佺簿纭暟瀛椼€佸綋澶╄姹傛暟銆?- 渚涘簲鍟嗘媶鍒嗭紙浠婃棩 / 绱锛夛紝鎸夋瘡姝ヤ簨浠剁殑 `data.message.source.provider` 鍒嗙粍锛屽彲涓庡悇瀹剁綉鍏宠处鍗曞璐︺€?- 缁ф壙鍓嶇紑鍘婚噸锛歠ork/seed 浼氳瘽鎶勫湪鏃ュ織澶撮儴鐨勫壇鏈笉璁″叆锛岄櫎闈炴潵婧愪細璇濆凡涓嶅湪鏈満銆?- 蹇収蹇彇锛氬閲忔壂鎻忓彧閲嶈浠嶅湪杩愯鐨勪細璇濓紝钀界洏缂撳瓨鐗堟湰鍖栵紙鍙ｅ緞鍙樻洿鑷姩閲嶅缓锛夈€