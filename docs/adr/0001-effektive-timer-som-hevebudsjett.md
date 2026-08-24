# All heving regnes i effektive timer, ikke klokketimer

En hevefase beskrives i appen med klokketid og temperatur, men alt som regnes
ut av den (gjærmengde, surdeigskobling, alarmens mål, Juster underveis)
bruker **effektive timer**: klokketimer omregnet til timer ved 21 °C, vektet
med gjæraktiviteten. Planen er altså et *hevebudsjett* av effektive timer, og
klokketiden er bare måten brukeren uttrykker det.

Grunnen er at appen må kunne legge sammen faser ved ulik temperatur. En kald
etterheving på 12 timer ved 6 °C og en bulkheving på 2 timer ved 21 °C har
ingen felles enhet i klokketid, men er sammenlignbare i effektive timer. Uten
det ville hver kombinasjon av hevemetode og temperatur trengt sin egen tabell.

## Vurderte alternativer

- **Klokketimer med en oppslagstabell per temperatur.** Enklere å lese, men
  faser kan ikke summeres, og hver ny funksjon (vanntemperatur, kald fase,
  Juster underveis) ville trengt egne tabellrader.
- **Klokketimer og ignorer temperatur.** Det appen gjorde først. Dette gjør
  kald etterheving og romtemperatur-avvik ubrukelige som funksjoner.

## Konsekvenser

- Deigtemperaturen er ikke konstant gjennom en fase: vannet kan være varmere
  eller kaldere enn rommet, og en romtemperert deig i kjøleskap gjærer godt
  mens den kjøler ned. Effektive timer for en fase integreres derfor numerisk
  over Newtons avkjøling, ikke som timer × faktor.
- Modellen er bare så god som tidskonstantene den bruker. Tau er anslått
  (rundt 2,5 t ved romtemp, 3 t i kjøleskap), ikke målt, og varierer mye med
  deigstørrelse og bolle. Tallene er veiledende, og appen sier det.
- Juster underveis er nesten gratis når budsjettet finnes: forbrukt mot
  budsjett er en subtraksjon, ikke en ny modell.
