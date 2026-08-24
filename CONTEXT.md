# Eltefritt

Kalkulator for eltefritt brød: brukeren velger brød, mel, heveform og
hevemetode, og appen regner ut oppskrift, tidsplan og en alarm når hevingen er
ferdig. Ordlista under er appens språk. Bruk disse ordene i kode, tekst og
samtale.

## Metoden

**Eltefritt**:
Bakemetoden appen dekker: høy hydrering og lang heving i stedet for elting, og
steking i forvarmet jerngryte.
_Unngå_: no-knead, Lahey-metoden

**Heveform**:
Hva som får deigen til å heve: tørrgjær, ferskgjær eller surdeig. Bestemmer
ingrediensene.
_Unngå_: gjærtype, hevemiddel

**Hevemetode**:
Hvordan hevingen er lagt opp i tid: Klassisk eller Kald etterheving. Bestemmer
tidsplanen. Uavhengig av heveform, så surdeig kan brukes i begge.
_Unngå_: hevemodus, modus, metode alene

**Klassisk**:
Hevemetoden med lang bulkheving på romtemperatur og kort etterheving før
steking, alt samme døgn.

**Kald etterheving**:
Hevemetoden med kort bulkheving på romtemperatur og lang etterheving i
kjøleskap. Navnet er hevemetodens, ikke fasens: fasen heter etterheving som
ellers, den er bare kald.

## Fasene

Rekkefølgen er alltid bland, bulkheving, forming, etterheving, steking,
avkjøling.

**Bulkheving**:
Første heving, hele deigen i bollen, fra blanding til forming. Skjer alltid på
romtemperatur.
_Unngå_: hevetid, ønsket hevetid, førsteheving, bulk alene

**Etterheving**:
Hevingen etter forming og før steking. På romtemperatur i Klassisk, i kjøleskap
i Kald etterheving.
_Unngå_: andreheving, kaldheving, proofing

**Hevingen ferdig**:
Øyeblikket den ubetjente hevingen tar slutt og bakeren må gjøre noe. Slutten av
bulkhevingen i Klassisk (da former du), slutten av etterhevingen i Kald
etterheving (da skal brødet i ovnen). Alarmen fyrer her, aldri ved slutten av
stekingen.

**Forming**:
Å stramme deigen til en kule før etterhevingen. Anbefalt, men valgfri i
Klassisk, der deigen kan slippes rett i den varme gryta etter bulkhevingen.

## Deigen

**Hydrering**:
Vann i prosent av melvekten. Alltid oppgitt som prosent, aldri som gram.

**Meltype**:
En melsort brukeren kan velge, for eksempel hvete, sammalt rug eller spelt.
Hver har sitt hydreringsområde.

**Melandel**:
En meltypes andel av melet, i prosent. Andelene skal summere til 100.

**Hydreringsområde**:
Intervallet hydrering en meltype trives med. Blandinger vektes etter melandel,
og appen foreslår midtpunktet.
_Unngå_: anbefalt hydrering (det er ett tall, dette er alltid et intervall)

**Inokulering**:
Surdeig i prosent av totalt mel. Regnes på en 100 % hydrert starter, altså
halvparten mel og halvparten vann. Kalles Surdeig-mengde i grensesnittet.
_Unngå_: starterprosent, levain-andel

**Surdeigskobling**:
At inokulering og bulkhevingens lengde er én frihetsgrad, ikke to: mer surdeig
gir kortere bulk. Gjelder bare når heveformen er surdeig.

**Leder**:
Den av inokulering og bulktid brukeren satte sist. Den andre er følger og
regnes ut fra lederen.

## Tid og temperatur

**Romtemperatur**:
Temperaturen deigen hever i. Referansen alt annet måles mot er 21 °C.

**Vanntemperatur**:
Temperaturen på vannet i deigen. Følger romtemperatur til brukeren setter den
selv, og er måten å styre starttemperaturen i deigen.

**Deigtemperatur**:
Temperaturen i deigen. Utledet, aldri satt: den starter som en vekting av
vann og mel etter varmekapasitet, og glir mot omgivelsene.

**Kjøleskapstemperatur**:
Temperaturen i den kalde etterhevingen. Standard er 6 °C, ikke 4 °C, fordi
norske kjøleskap sjelden er så kalde.

**Gjæraktivitet**:
Hvor fort deigen hever ved en gitt temperatur, relativt til 21 °C. Dobles per
10 °C ned til rundt 10 °C, og faller brattere under det. Gjæren er nær dvale
ved kjøleskapstemperatur.
_Unngå_: gjærhastighet, fermenteringsrate

**Effektive timer**:
Klokketimer omregnet til timer ved 21 °C, vektet med gjæraktiviteten. Dette er
enheten all heving regnes i, så faser ved ulik temperatur kan legges sammen.
_Unngå_: justerte timer, vektede timer

**Hevebudsjett**:
Antallet effektive timer en plan er verdt. Gjærmengden regnes ut fra
budsjettet, ikke fra klokketiden, så en kald plan får mer gjær enn en varm av
samme lengde.

**Faktisk temperatur**:
Temperaturen deigen har stått i så langt, ikke temperaturen akkurat nå.
Brukeren oppgir den under Juster underveis når rommet ble varmere eller
kaldere enn planlagt.
_Unngå_: nåværende temperatur, målt temperatur

**Juster underveis**:
Å regne om gjenstående hevetid mens hevingen pågår, ut fra faktisk
temperatur. Sammenligner forbrukt mot hevebudsjett og flytter alarmen.

## Bakeplanen

**Bakeplan**:
Tidslinja fra deigen blandes til brødet er ferdig stekt, med et klokkeslett
per steg.
_Unngå_: tidsplan, timeplan, skjema

**Anker**:
Enden av bakeplanen brukeren festet: start eller klar. Den andre enden regnes
ut. Settes klar-tiden, strekkes hevingen først, og starten flyttes bare om
hevingen ikke kan strekkes langt nok.

**Frosset start**:
Starttidspunktet som absolutt tidspunkt, ikke som klokkeslett. Nødvendig mens
alarmen står på, fordi et klokkeslett er tvetydig over døgnskiftet.

**Gjenopptak**:
Å plukke opp en pågående bake etter at appen er lukket og åpnet igjen. En bake
er pågående til planlagt ferdigtid, forlenget hvis Juster underveis har
skjøvet den.

## Varsling

**Varsling**:
Alt apparatet som gjør bakeren oppmerksom når hevingen er ferdig: varsel, lyd,
vibrasjon, ikonmerke og blinkende fanetittel, med en planlagt push som backup
når appen er lukket.

**Alarm**:
Brukerens av/på for varsling. Er den på, er starten frosset og nedtellingen
løper.

**Kvittering**:
At bakeren har fått med seg alarmen. Å røre appen, komme tilbake til fanen
eller skru av alarmen kvitterer; da slutter den å gjenta seg.

## Utstyret

**Jerngryte**:
Gryta med lokk brødet stekes i, forvarmet. Størrelsen følger melvekten per
brød. Brødform er alternativet, med lavere temperatur og uten lokk.

**Banneton**:
Hevekorgen deigen etterhever i. Anbefales i alle hevemetoder, ikke bare kald,
men er valgfri.
