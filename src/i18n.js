'use strict';

// Internasjonalisering + temperaturenheter for Eltefritt.
//
// Lastes i nettleseren som vanlig <script> (eksponerer window.EltefrittI18n);
// importeres i tester via Node's require (module.exports = api).
//
// Ansvar:
//  - MESSAGES: hele oversettelseskatalogen (nb + en). Én flat nøkkel per streng.
//    Verdier er enten strenger (med {param}-plassholdere) eller arrays (ukedager).
//  - detectLang / detectUnit: gjett språk og temperaturenhet fra nettleseren.
//  - createTranslator(lang): gir en t(key, params)-funksjon.
//  - convertTemp / formatTemp: Celsius → visning i valgt enhet. Modellen er
//    alltid Celsius; her skjer kun visningskonvertering.
//  - formatNumber / formatTimeHM / dayLabelKey: locale-bevisst formatering.
//
// Render-laget (index.html) bestemmer enhet og locale; t() interpolerer bare
// allerede-formaterte verdier inn i plassholderne.

(function (globalScope) {
  const SUPPORTED_LANGS = ['nb', 'en'];
  // Fallback når nettleseren verken er norsk eller engelsk: engelsk er mest
  // sannsynlig forstått internasjonalt.
  const DEFAULT_LANG = 'en';

  // Regioner som bruker Fahrenheit til dagligdags temperatur.
  const FAHRENHEIT_REGIONS = new Set(['US', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH', 'LR']);

  const MESSAGES = {
    nb: {
      // ── Dokument / meta ──
      'doc.title': 'Eltefritt: kalkulator for eltefritt brød',
      'doc.metaDescription': 'Kalkulator og bakplan for eltefritt brød. Jim Lahey-metoden, med støtte for kald etterheving.',
      'app.subtitle': 'Kalkulator for eltefritt brød',

      // ── Kort-titler ──
      'card.bread': 'Brødet',
      'card.rise': 'Heving',
      'card.timeline': 'Tidsplan',
      'card.recipe': 'Oppskrift',
      'method.summary': 'Slik gjør du det',

      // ── Feltlabels ──
      'field.loaves': 'Antall brød',
      'field.size': 'Brødstørrelse',
      'field.sizeCustomLabel': 'eller egen vekt',
      'field.sizeUnit': 'g mel',
      'field.flourType': 'Meltype',
      'field.hydration': 'Hydrering',
      'field.riseMethod': 'Heveform',
      'field.riseMode': 'Hevemetode',
      'field.roomTemp': 'Romtemperatur',
      'field.waterTemp': 'Vanntemperatur',
      'field.waterTemp.grams': 'til {grams} g vann',
      'field.desiredRise': 'Ønsket hevetid',
      'field.bulkRoom': 'Bulkheving (romtemp)',
      'field.coldProof': 'Kald etterheving',
      'field.coldTemp': 'Kjøleskapstemp',
      'field.sourAmount': 'Surdeig-mengde',
      'field.alarm': 'Alarm når hevingen er ferdig',

      // ── Alarm / nedtelling ──
      'alarm.off': 'Av',
      'alarm.on': 'På',
      'alarm.help': 'Få et varsel når hevetiden er ute – appen piper til du kvitterer. Fanen må stå åpen (også i bakgrunnen).',
      'alarm.countdown': '⏰ {dur} til hevingen er ferdig',
      'alarm.done': '⏰ Hevingen er ferdig – på tide med neste steg!',
      'alarm.blocked': 'Varsler er blokkert i nettleseren, men appen piper når tiden er ute (så lenge fanen er åpen).',
      'alarm.notify.title': 'Hevingen er ferdig 🍞',
      'alarm.notify.body': 'Klar for neste steg i oppskriften.',

      // ── Juster underveis ──
      'field.adjust': 'Juster underveis',
      'adjust.help': 'Ble rommet varmere eller kaldere enn planlagt? Sett temperaturen deigen faktisk har stått i, så flyttes klar-tiden og alarmen.',
      'adjust.readyAt': 'Med denne temperaturen er bulkhevingen ferdig ca. {time}. Sjekk deigen: doblet, boblete og dirrende = klar.',
      'adjust.overdue': 'Deigen har trolig hevet ferdig – form den nå, og kort heller inn etterhevingen.',

      // ── Enheter ──
      'unit.hours': 't',
      'unit.min': 'min',
      'unit.sec': 'sek',

      // ── Knapper ──
      'flour.addBtn': '+ Legg til meltype',

      // ── Segmenter ──
      'size.small': 'Lite',
      'size.medium': 'Medium',
      'size.large': 'Stort',
      'size.custom': '{g} g',
      'leaven.dry': 'Tørrgjær',
      'leaven.fresh': 'Ferskgjær',
      'leaven.sourdough': 'Surdeig',
      'mode.classic.label': 'Klassisk',
      'mode.cold.label': 'Kald etterheving',

      // ── Innstillinger ──
      'settings.title': 'Innstillinger',
      'settings.language': 'Språk',
      'settings.unit': 'Enhet',
      'settings.theme': 'Tema',
      'lang.norwegian': 'Norsk',
      'lang.english': 'English',
      'unit.celsius': 'Celsius',
      'unit.fahrenheit': 'Fahrenheit',
      'theme.light': 'Lyst',
      'theme.dark': 'Mørkt',
      'theme.auto': 'Auto',
      'aria.settingsBtn': 'Innstillinger',

      // ── Slider-ord-markører ──
      'mark.drier': 'tørrere',
      'mark.wetter': 'våtere',

      // ── Hjelpetekster ──
      'helper.hydration': 'Mer vann = åpnere krumme, men klissete deig. Anbefaling justeres med meltype.',
      'helper.waterTemp': 'Følger romtemp som standard. Varmt vann gir hodestart i bulkhevingen, så modellen kompenserer ved å redusere gjær. Hold under {maxTemp}; over det skades gjær og surdeig.',
      'helper.riseTime': '12–18 timer gir best smak og struktur. Kortere tid krever mer gjær.',
      'helper.coldTime': 'Lengre tid i kjøleskap = dypere smak og enklere håndtering. 12–24 t er typisk.',
      'helper.sourAmount': '% av total mel. Forutsetter aktiv, 100%-hydrert starter (peak ~4–8 t etter mating). Anbefalt bulk-tid (~11 t ved 20% / {temp}) er et utgangspunkt; faktisk tid varierer ±25% med starter-styrke.',

      // ── Heveform-detaljer ──
      'leaven.detail.dry': 'Standard. 0,23% gir 14 t god heving ved {temp}.',
      'leaven.detail.fresh': '≈ 3× tørrgjær, smuldres direkte i vannet.',
      'leaven.detail.sourdough': 'Aktiv 100%-hydrert starter. Krever erfaring med starter-styrke; tider er omtrentlige.',

      // ── Hevemetode-detaljer ──
      'mode.classic.detail': 'Lang bulkheving + kort etterheving før steking.',
      'mode.cold.detail': 'Kort bulk + lang etterheving i kjøleskap (banneton-vennlig).',

      // ── Ingredienser ──
      'ingredient.flour': 'Mel',
      'ingredient.water': 'Vann',
      'ingredient.salt': 'Salt',
      'ingredient.salt.sub': '2 %',
      'ingredient.starter': 'Surdeig',
      'ingredient.starter.sub': 'aktiv, 100% hydrering',
      'water.sub.roomTemp': 'romtemperert',
      'yeast.dry': 'Tørrgjær',
      'yeast.fresh': 'Ferskgjær',
      'yeast.detail.dry': '{pct} % · {grams} g fersk',
      'yeast.detail.fresh': '{pct} % · {grams} g tørr',

      // ── Mel: sum / antall / navn ──
      'flourSum.exact': 'Sum: 100%',
      'flourSum.remaining': 'Sum: {total}% · {diff}% igjen',
      'flourSum.over': 'Sum: {total}% · {diff}% for mye',
      'flour.typesLabelOther': '({count} typer)',
      'flour.hvete': 'Hvetemel',
      'flour.sammalt': 'Sammalt hvete',
      'flour.sammaltfin': 'Sammalt hvete, fin',
      'flour.rug': 'Rugmel',
      'flour.sammaltrug': 'Sammalt rug',
      'flour.spelt': 'Speltmel',
      'flour.durum': 'Durumhvete',
      'flour.havre': 'Havremel',
      'flour.bygg': 'Byggmel',

      // ── Hydreringsforslag ──
      'hydration.suggestion.single': '~{n}% vann',
      'hydration.suggestion.range': '{min}–{max}% vann',

      // ── Utstyr ──
      'equipment.line': '{pot}. Banneton {banneton} (valgfritt)',
      'equipment.perLoaf': ' (per brød)',
      'equipment.pot.s': 'Jerngryte 4–4,5 L (23–24 cm), eller brødform 2 L',
      'equipment.pot.m': 'Jerngryte 5 L (26 cm), eller brødform 2,5 L',
      'equipment.pot.l': 'Jerngryte 6 L (28 cm), eller stor brødform',
      'equipment.pot.xl': 'Jerngryte 7 L eller større (30 cm), eller stor brødform',
      'equipment.pot.xxl': 'tilpass utstyr etter deigmengde',
      'banneton.s': '23 cm rundt',
      'banneton.m': '25 cm rundt',
      'banneton.l': '28 cm rundt',
      'banneton.xl': '30 cm rundt (eller oval)',
      'banneton.xxl': 'stor banneton',

      // ── Størrelse-detalj ──
      'size.detail': '≈ {flour} g mel · ~{finished} g ferdig brød',

      // ── Tidsplan ──
      'plan.start': 'Start',
      'plan.ready': 'Klar',
      'plan.nowBtn': '↻ nå',
      'plan.nowBtn.title': 'Sett start til nå',
      'plan.bulk': 'Bulkheving · {hours} t ved {temp}',
      'plan.secondProof': 'Etterheving · ~{hours} t',
      'plan.cold': 'I kjøleskap · {hours} t ved {temp}',
      'plan.bake': 'Steking · ~45 min',
      'plan.shapeClassic': 'Form og etterhev',
      'plan.intoOven': 'Inn i ovnen',
      'plan.shapeCold': 'Form og legg i banneton',
      'plan.intoOvenCold': 'Inn i ovnen (rett fra kjøleskap)',

      // ── Dager ──
      'day.today': 'i dag',
      'day.tomorrow': 'i morgen',
      'day.dayAfter': 'overimorgen',
      'day.weekdaysShort': ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'],

      // ── Instruksjonssteg ──
      'step.starterCheck.title': 'Sjekk starter',
      'step.starterCheck.body': 'Bruk en aktiv, 100%-hydrert starter (peak ca. 4–8 t etter mating ved romtemp). Float-test: en liten klatt skal flyte i et glass vann.',
      'step.mix.title': 'Bland',
      'step.mix.dryTitle': 'Bland tørt',
      'step.mix.body.dry': 'Visp sammen mel, salt og tørrgjær i en stor bolle. Hell i alt vannet og rør med slikkepott til alt er fuktet. Deigen skal være klissete og uregelmessig. Ikke elt.',
      'step.mix.body.fresh': 'Visp sammen mel og salt i en stor bolle. Smuldre ferskgjæren i vannet og rør raskt sammen, og hell over melet. Rør til en klissete, uregelmessig deig. Ikke elt.',
      'step.mix.body.sourdough': 'Løs opp surdeigen i vannet med fingrene. Tilsett mel og salt, og rør til en grov, klissete deig.',
      'step.bulk.title': 'Bulkheving',
      'step.bulk.body.classic.yeast': 'Dekk bollen med plastfolie eller lokk. La heve ved romtemperatur til deigen er ca. dobbelt så stor og full av bobler på overflaten.',
      'step.bulk.body.classic.sourdough': 'Dekk bollen. La heve ved romtemperatur. Gjør 3–4 stretch & fold første 1,5–2 t for struktur. Deigen skal være luftig og pill med bobler, 50–75% større når den er klar.',
      'step.bulk.body.cold': 'Dekk og la stå ved romtemperatur. Gjør gjerne 2–3 stretch & fold underveis for ekstra struktur.',
      'step.shape.title': 'Form',
      'step.shape.body': 'Vend deigen ut på godt melet benk. Brett inn fra alle kantene mot midten, snu med skjøten ned og forme til en kule. La etterheve på melet kjøkkenhåndkle eller i banneton i 1–2 t, til deigen er synlig luftigere og rundt 50 % større. Snarvei: hopp over forming og plopp deigen rett i den varme gryta etter bulk, det blir litt rustikkere men funker fint.',
      'step.shapeCold.title': 'Form og legg i banneton',
      'step.shapeCold.body': 'Vend ut på godt melet benk. Brett inn fra kantene mot midten og forme til en kule eller batard. Mel en banneton (gjerne med rismel) og legg deigen i med skjøtesiden opp.',
      'step.coldProof.title': 'Kald etterheving',
      'step.coldProof.body.yeast': 'Dekk banneton med plastpose eller dusjhette og sett i kjøleskap. Lang tid gir dypere smak og enklere skåring.',
      'step.coldProof.body.sourdough': 'Dekk banneton med plastpose eller dusjhette og sett i kjøleskap. 12–18 t gir god smak og enklere skåring.',
      'step.bake.title': 'Stek',
      'step.bake.body': 'I jerngryte: forvarm gryte med lokk til {hot}. Vipp deigen forsiktig oppi, sett på lokket og stek 30 min. Ta av lokket, skru ned til {low} og stek videre ~15 min til brødet er gyllent og lyder hult når du banker på bunnen. I brødform: smør formen, hell deigen i, og stek på {pan} i ~40 min. Sett en skål med kokende vann i bunnen av ovnen de første 15 min for sprøere skorpe.',
      'step.bakeCold.title': 'Stek direkte fra kjøleskap',
      'step.bakeCold.body': 'I jerngryte: forvarm gryte med lokk til {hot}. Vipp deigen rett fra kald banneton over på bakepapir, skår med kniv eller barberblad, og senk i den varme gryta. Lokk på, stek 30 min. Ta av lokket, skru ned til {low} og stek ~15 min til gyllent. I brødform: smør formen, hell deigen i (skår om ønskelig), stek på {pan} i ~40 min. Sett en skål med kokende vann i bunnen av ovnen de første 15 min for sprøere skorpe.',
      'step.cool.title': 'Avkjøl',
      'step.cool.body.short': 'La brødet avkjøle på rist i minst 30 min før du skjærer.',
      'step.cool.body.sourdough': 'La avkjøle på rist i minst 1 t før du skjærer. Surdeigsbrød trenger lengre tid for å sette seg enn gjærbakt.',
      'step.cool.body.sourdoughShort': 'La avkjøle på rist i minst 1 t før du skjærer.',

      // ── Mel-tips ──
      'tip.rye': 'Rene rugbrød hever dårlig med vanlig gjær. Vurder surdeig, eller bland inn mer hvete.',
      'tip.lowGluten': 'Havre og bygg har lite gluten. Hold andelen under 30 % for en deig som hever godt.',

      // ── Surdeig-klampe-notater ──
      'sour.recUnder1': 'under 1',
      'sour.bulkOverMax': '⚠️ Anbefalt bulk er {recText} t, mer enn slideren tillater ({max} t). Øk surdeigsmengden{extra}.',
      'sour.bulkOverMax.extraCold': ', eller forleng kald etterheving',
      'sour.bulkUnder': '⚠️ Anbefalt bulk er bare {recText} t. Reduser surdeigsmengden for å unngå overheving.',
      'sour.inocOverMax': '⚠️ Så kort heving trenger ~{rec} % surdeig; slideren stopper på {max} %. Forleng hevingen, eller regn med tettere brød.',
      'sour.inocUnder': '⚠️ Så lang heving trenger bare ~{rec} % surdeig; slideren stopper på {min} %. Kort ned hevingen for å unngå overheving.',

      // ── ARIA ──
      'aria.decrease': 'Reduser {field}',
      'aria.increase': 'Øk {field}',
      'aria.field.hydration': 'hydrering',
      'aria.field.roomTemp': 'romtemperatur',
      'aria.field.waterTemp': 'vanntemperatur',
      'aria.field.riseTime': 'hevetid',
      'aria.field.bulk': 'bulkheving',
      'aria.field.coldProof': 'kald etterheving',
      'aria.field.coldTemp': 'kjøleskapstemperatur',
      'aria.field.sourAmount': 'surdeig-mengde',
      'aria.field.adjustTemp': 'faktisk temperatur',
      'aria.flourShare': 'Andel {name}',
      'aria.flourShareField': 'andel {name}',
      'aria.removeFlour': 'Fjern meltype',

      // ── Footer ──
      'footer.line1': 'Eltefritt-kalkulator · basert på Jim Lahey-metoden',
      'footer.line2': 'Mengder er per brød × antall brød. Tilpass etter erfaring og bakebehov.'
    },

    en: {
      // ── Document / meta ──
      'doc.title': 'Eltefritt: no-knead bread calculator',
      'doc.metaDescription': 'Calculator and baking schedule for no-knead bread. The Jim Lahey method, with support for cold proofing.',
      'app.subtitle': 'No-knead bread calculator',

      // ── Card titles ──
      'card.bread': 'The bread',
      'card.rise': 'Proofing',
      'card.timeline': 'Schedule',
      'card.recipe': 'Recipe',
      'method.summary': 'How to do it',

      // ── Field labels ──
      'field.loaves': 'Number of loaves',
      'field.size': 'Loaf size',
      'field.sizeCustomLabel': 'or custom weight',
      'field.sizeUnit': 'g flour',
      'field.flourType': 'Flour type',
      'field.hydration': 'Hydration',
      'field.riseMethod': 'Leaven',
      'field.riseMode': 'Method',
      'field.roomTemp': 'Room temperature',
      'field.waterTemp': 'Water temperature',
      'field.waterTemp.grams': 'for {grams} g water',
      'field.desiredRise': 'Desired rise time',
      'field.bulkRoom': 'Bulk rise (room temp)',
      'field.coldProof': 'Cold proof',
      'field.coldTemp': 'Fridge temp',
      'field.sourAmount': 'Sourdough amount',
      'field.alarm': 'Alarm when the rise is done',

      // ── Alarm / countdown ──
      'alarm.off': 'Off',
      'alarm.on': 'On',
      'alarm.help': 'Get a notification when the rise time is up – the app keeps beeping until you acknowledge it. Keep this tab open (background is fine).',
      'alarm.countdown': '⏰ {dur} until the rise is done',
      'alarm.done': '⏰ The rise is done – time for the next step!',
      'alarm.blocked': 'Notifications are blocked in your browser, but the app will beep when time is up (as long as this tab is open).',
      'alarm.notify.title': 'The rise is done 🍞',
      'alarm.notify.body': 'Ready for the next step in the recipe.',

      // ── Adjust mid-rise ──
      'field.adjust': 'Adjust mid-rise',
      'adjust.help': 'Room warmer or colder than planned? Set the temperature the dough has actually seen, and the ready time and alarm move to match.',
      'adjust.readyAt': 'At this temperature the bulk rise is done around {time}. Check the dough: doubled, bubbly and jiggly = ready.',
      'adjust.overdue': 'The dough has likely finished rising – shape it now, and shorten the second proof instead.',

      // ── Units ──
      'unit.hours': 'h',
      'unit.min': 'min',
      'unit.sec': 's',

      // ── Buttons ──
      'flour.addBtn': '+ Add flour type',

      // ── Segments ──
      'size.small': 'Small',
      'size.medium': 'Medium',
      'size.large': 'Large',
      'size.custom': '{g} g',
      'leaven.dry': 'Dry yeast',
      'leaven.fresh': 'Fresh yeast',
      'leaven.sourdough': 'Sourdough',
      'mode.classic.label': 'Classic',
      'mode.cold.label': 'Cold proof',

      // ── Settings ──
      'settings.title': 'Settings',
      'settings.language': 'Language',
      'settings.unit': 'Unit',
      'settings.theme': 'Theme',
      'lang.norwegian': 'Norsk',
      'lang.english': 'English',
      'unit.celsius': 'Celsius',
      'unit.fahrenheit': 'Fahrenheit',
      'theme.light': 'Light',
      'theme.dark': 'Dark',
      'theme.auto': 'Auto',
      'aria.settingsBtn': 'Settings',

      // ── Slider word marks ──
      'mark.drier': 'drier',
      'mark.wetter': 'wetter',

      // ── Helper texts ──
      'helper.hydration': 'More water = a more open crumb, but stickier dough. The suggestion adjusts to flour type.',
      'helper.waterTemp': 'Follows room temp by default. Warm water gives the bulk rise a head start, so the model compensates by reducing yeast. Keep below {maxTemp}; above that, yeast and sourdough are damaged.',
      'helper.riseTime': '12–18 hours gives the best flavour and structure. Shorter times need more yeast.',
      'helper.coldTime': 'Longer in the fridge = deeper flavour and easier handling. 12–24 h is typical.',
      'helper.sourAmount': '% of total flour. Assumes an active, 100%-hydration starter (peak ~4–8 h after feeding). Recommended bulk time (~11 h at 20% / {temp}) is a starting point; actual time varies ±25% with starter strength.',

      // ── Leaven details ──
      'leaven.detail.dry': 'Standard. 0.23% gives 14 h of good rise at {temp}.',
      'leaven.detail.fresh': '≈ 3× dry yeast, crumbled straight into the water.',
      'leaven.detail.sourdough': 'Active 100%-hydration starter. Requires experience with starter strength; times are approximate.',

      // ── Method details ──
      'mode.classic.detail': 'Long bulk rise + short final proof before baking.',
      'mode.cold.detail': 'Short bulk + long proof in the fridge (banneton-friendly).',

      // ── Ingredients ──
      'ingredient.flour': 'Flour',
      'ingredient.water': 'Water',
      'ingredient.salt': 'Salt',
      'ingredient.salt.sub': '2%',
      'ingredient.starter': 'Sourdough',
      'ingredient.starter.sub': 'active, 100% hydration',
      'water.sub.roomTemp': 'room temp',
      'yeast.dry': 'Dry yeast',
      'yeast.fresh': 'Fresh yeast',
      'yeast.detail.dry': '{pct}% · {grams} g fresh',
      'yeast.detail.fresh': '{pct}% · {grams} g dry',

      // ── Flour: sum / count / names ──
      'flourSum.exact': 'Sum: 100%',
      'flourSum.remaining': 'Sum: {total}% · {diff}% left',
      'flourSum.over': 'Sum: {total}% · {diff}% over',
      'flour.typesLabelOther': '({count} types)',
      'flour.hvete': 'Wheat flour',
      'flour.sammalt': 'Whole wheat',
      'flour.sammaltfin': 'Whole wheat, fine',
      'flour.rug': 'Rye flour',
      'flour.sammaltrug': 'Whole rye',
      'flour.spelt': 'Spelt flour',
      'flour.durum': 'Durum wheat',
      'flour.havre': 'Oat flour',
      'flour.bygg': 'Barley flour',

      // ── Hydration suggestion ──
      'hydration.suggestion.single': '~{n}% water',
      'hydration.suggestion.range': '{min}–{max}% water',

      // ── Equipment ──
      'equipment.line': '{pot}. Banneton {banneton} (optional)',
      'equipment.perLoaf': ' (per loaf)',
      'equipment.pot.s': 'Dutch oven 4–4.5 L (23–24 cm), or loaf pan 2 L',
      'equipment.pot.m': 'Dutch oven 5 L (26 cm), or loaf pan 2.5 L',
      'equipment.pot.l': 'Dutch oven 6 L (28 cm), or large loaf pan',
      'equipment.pot.xl': 'Dutch oven 7 L or larger (30 cm), or large loaf pan',
      'equipment.pot.xxl': 'adjust equipment to dough volume',
      'banneton.s': '23 cm round',
      'banneton.m': '25 cm round',
      'banneton.l': '28 cm round',
      'banneton.xl': '30 cm round (or oval)',
      'banneton.xxl': 'large banneton',

      // ── Size detail ──
      'size.detail': '≈ {flour} g flour · ~{finished} g finished loaf',

      // ── Schedule ──
      'plan.start': 'Start',
      'plan.ready': 'Ready',
      'plan.nowBtn': '↻ now',
      'plan.nowBtn.title': 'Set start to now',
      'plan.bulk': 'Bulk rise · {hours} h at {temp}',
      'plan.secondProof': 'Final proof · ~{hours} h',
      'plan.cold': 'In the fridge · {hours} h at {temp}',
      'plan.bake': 'Baking · ~45 min',
      'plan.shapeClassic': 'Shape and proof',
      'plan.intoOven': 'Into the oven',
      'plan.shapeCold': 'Shape and place in banneton',
      'plan.intoOvenCold': 'Into the oven (straight from the fridge)',

      // ── Days ──
      'day.today': 'today',
      'day.tomorrow': 'tomorrow',
      'day.dayAfter': 'in two days',
      'day.weekdaysShort': ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],

      // ── Instruction steps ──
      'step.starterCheck.title': 'Check the starter',
      'step.starterCheck.body': 'Use an active, 100%-hydration starter (peak about 4–8 h after feeding at room temp). Float test: a small blob should float in a glass of water.',
      'step.mix.title': 'Mix',
      'step.mix.dryTitle': 'Mix dry',
      'step.mix.body.dry': 'Whisk together flour, salt and dry yeast in a large bowl. Pour in all the water and stir with a spatula until everything is moistened. The dough should be sticky and shaggy. Do not knead.',
      'step.mix.body.fresh': 'Whisk together flour and salt in a large bowl. Crumble the fresh yeast into the water and stir quickly, then pour over the flour. Stir to a sticky, shaggy dough. Do not knead.',
      'step.mix.body.sourdough': 'Dissolve the sourdough in the water with your fingers. Add flour and salt, and stir to a rough, sticky dough.',
      'step.bulk.title': 'Bulk rise',
      'step.bulk.body.classic.yeast': 'Cover the bowl with plastic wrap or a lid. Let it rise at room temperature until the dough is about doubled and full of bubbles on the surface.',
      'step.bulk.body.classic.sourdough': 'Cover the bowl. Let it rise at room temperature. Do 3–4 stretch & folds over the first 1.5–2 h for structure. The dough should be airy and dotted with bubbles, 50–75% larger when ready.',
      'step.bulk.body.cold': 'Cover and leave at room temperature. Feel free to do 2–3 stretch & folds along the way for extra structure.',
      'step.shape.title': 'Shape',
      'step.shape.body': 'Turn the dough out onto a well-floured surface. Fold in all the edges toward the centre, flip seam-side down and shape into a ball. Let it proof on a floured kitchen towel or in a banneton for 1–2 h, until visibly airier and around 50% larger. Shortcut: skip shaping and plop the dough straight into the hot pot after bulk, it comes out a bit more rustic but works fine.',
      'step.shapeCold.title': 'Shape and place in banneton',
      'step.shapeCold.body': 'Turn out onto a well-floured surface. Fold in the edges toward the centre and shape into a ball or batard. Flour a banneton (rice flour works well) and place the dough in seam-side up.',
      'step.coldProof.title': 'Cold proof',
      'step.coldProof.body.yeast': 'Cover the banneton with a plastic bag or shower cap and put it in the fridge. A long time gives deeper flavour and easier scoring.',
      'step.coldProof.body.sourdough': 'Cover the banneton with a plastic bag or shower cap and put it in the fridge. 12–18 h gives good flavour and easier scoring.',
      'step.bake.title': 'Bake',
      'step.bake.body': 'In a Dutch oven: preheat the pot with its lid to {hot}. Tip the dough in gently, put the lid on and bake 30 min. Remove the lid, turn down to {low} and bake another ~15 min until the loaf is golden and sounds hollow when you tap the bottom. In a loaf pan: grease the pan, pour the dough in, and bake at {pan} for ~40 min. Put a dish of boiling water in the bottom of the oven for the first 15 min for a crispier crust.',
      'step.bakeCold.title': 'Bake straight from the fridge',
      'step.bakeCold.body': 'In a Dutch oven: preheat the pot with its lid to {hot}. Tip the dough straight from the cold banneton onto baking paper, score with a knife or razor, and lower it into the hot pot. Lid on, bake 30 min. Remove the lid, turn down to {low} and bake ~15 min until golden. In a loaf pan: grease the pan, pour the dough in (score if you like), bake at {pan} for ~40 min. Put a dish of boiling water in the bottom of the oven for the first 15 min for a crispier crust.',
      'step.cool.title': 'Cool',
      'step.cool.body.short': 'Cool the loaf on a rack for at least 30 min before slicing.',
      'step.cool.body.sourdough': 'Cool on a rack for at least 1 h before slicing. Sourdough needs longer to set than yeasted bread.',
      'step.cool.body.sourdoughShort': 'Cool on a rack for at least 1 h before slicing.',

      // ── Flour tips ──
      'tip.rye': 'Pure rye breads rise poorly with regular yeast. Consider sourdough, or mix in more wheat.',
      'tip.lowGluten': 'Oats and barley have little gluten. Keep them below 30% for a dough that rises well.',

      // ── Sourdough clamp notes ──
      'sour.recUnder1': 'under 1',
      'sour.bulkOverMax': '⚠️ Recommended bulk is {recText} h, more than the slider allows ({max} h). Increase the sourdough amount{extra}.',
      'sour.bulkOverMax.extraCold': ', or extend the cold proof',
      'sour.bulkUnder': '⚠️ Recommended bulk is only {recText} h. Reduce the sourdough amount to avoid over-proofing.',
      'sour.inocOverMax': '⚠️ Such a short rise needs ~{rec}% sourdough; the slider stops at {max}%. Extend the rise, or expect a denser loaf.',
      'sour.inocUnder': '⚠️ Such a long rise needs only ~{rec}% sourdough; the slider stops at {min}%. Shorten the rise to avoid over-proofing.',

      // ── ARIA ──
      'aria.decrease': 'Decrease {field}',
      'aria.increase': 'Increase {field}',
      'aria.field.hydration': 'hydration',
      'aria.field.roomTemp': 'room temperature',
      'aria.field.waterTemp': 'water temperature',
      'aria.field.riseTime': 'rise time',
      'aria.field.bulk': 'bulk rise',
      'aria.field.coldProof': 'cold proof',
      'aria.field.coldTemp': 'fridge temperature',
      'aria.field.sourAmount': 'sourdough amount',
      'aria.field.adjustTemp': 'actual temperature',
      'aria.flourShare': '{name} share',
      'aria.flourShareField': '{name} share',
      'aria.removeFlour': 'Remove flour type',

      // ── Footer ──
      'footer.line1': 'No-knead calculator · based on the Jim Lahey method',
      'footer.line2': 'Amounts are per loaf × number of loaves. Adjust to taste and experience.'
    }
  };

  // ---- Locale-tag for Intl ----
  function localeTag(lang) {
    return lang === 'nb' ? 'nb-NO' : 'en-GB';
  }

  // ---- Språk/enhet-deteksjon ----
  function langsFrom(navLike) {
    const nav = navLike || (typeof navigator !== 'undefined' ? navigator : null);
    if (!nav) return [];
    if (Array.isArray(nav.languages) && nav.languages.length) return nav.languages;
    if (nav.language) return [nav.language];
    return [];
  }

  function detectLang(navLike) {
    const langs = langsFrom(navLike);
    for (let i = 0; i < langs.length; i++) {
      const base = String(langs[i] || '').toLowerCase().split('-')[0];
      if (base === 'nb' || base === 'nn' || base === 'no') return 'nb';
      if (base === 'en') return 'en';
    }
    return DEFAULT_LANG;
  }

  function maximizeRegion(tag) {
    try {
      if (typeof Intl !== 'undefined' && Intl.Locale) {
        const loc = new Intl.Locale(String(tag));
        const max = loc.maximize ? loc.maximize() : loc;
        if (max && max.region) return String(max.region).toUpperCase();
      }
    } catch (e) {}
    return '';
  }

  function detectUnit(navLike) {
    const langs = langsFrom(navLike);
    // 1. Eksplisitt region-subtag (f.eks. en-US) vinner.
    for (let i = 0; i < langs.length; i++) {
      const m = String(langs[i]).match(/-([A-Za-z]{2})\b/);
      if (m) return FAHRENHEIT_REGIONS.has(m[1].toUpperCase()) ? 'f' : 'c';
    }
    // 2. Ellers: maksimer første språk til en region (en → US, nb → NO).
    for (let i = 0; i < langs.length; i++) {
      const r = maximizeRegion(langs[i]);
      if (r) return FAHRENHEIT_REGIONS.has(r) ? 'f' : 'c';
    }
    return 'c';
  }

  // ---- Oversetter ----
  function createTranslator(lang) {
    const L = MESSAGES[lang] ? lang : 'nb';
    const table = MESSAGES[L];
    function t(key, params) {
      let s = table[key];
      if (s === undefined) s = MESSAGES.nb[key];
      if (s === undefined) s = key;
      if (params && typeof s === 'string') {
        s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : '{' + k + '}'));
      }
      return s;
    }
    return { lang: L, t, has: (key) => table[key] !== undefined };
  }

  // ---- Temperatur (modellen er Celsius; her kun visning) ----
  function convertTemp(celsius, unit) {
    if (unit === 'f') return Math.round(celsius * 9 / 5 + 32);
    return Math.round(celsius);
  }

  function formatTemp(celsius, unit, locTag) {
    const n = convertTemp(celsius, unit);
    return formatNumber(n, locTag) + (unit === 'f' ? ' °F' : ' °C');
  }

  // ---- Tall ----
  function formatNumber(n, locTag, opts) {
    try {
      return new Intl.NumberFormat(locTag, opts).format(n);
    } catch (e) {
      return String(n);
    }
  }

  // ---- Tid (24t HH:MM, samme i begge språk; matcher <input type="time">) ----
  function formatTimeHM(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }

  // ---- Dag-etikett (returnerer nøkkel + evt. ukedag-indeks) ----
  function dayLabelKey(date, now) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const d0 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.round((d0.getTime() - today.getTime()) / 86400000);
    if (diffDays === 0) return { key: 'day.today', isToday: true };
    if (diffDays === 1) return { key: 'day.tomorrow', isToday: false };
    if (diffDays === 2) return { key: 'day.dayAfter', isToday: false };
    return { key: 'day.weekdaysShort', idx: date.getDay(), isToday: false };
  }

  const api = {
    MESSAGES,
    SUPPORTED_LANGS,
    DEFAULT_LANG,
    FAHRENHEIT_REGIONS,
    localeTag,
    detectLang,
    detectUnit,
    createTranslator,
    convertTemp,
    formatTemp,
    formatNumber,
    formatTimeHM,
    dayLabelKey
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.EltefrittI18n = api;
})(typeof window !== 'undefined' ? window : null);
