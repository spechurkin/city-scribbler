export const DISTRICT_TOPONYM_SOURCE = String.raw`
marketDistrictName
  [marketDistrictAdj] район ^3
  [marketDistrictAdj] посад ^2
  [marketSlobodaAdj] слобода ^3
  Слобода [marketGenitive] ^2
  [coastBayAdjective] слобода [marketGenitive] ^2
  Торжище [marketGenitive] ^2
  [coastBayAdjective] [marketSlobodaAdj.lowerCase] слобода
  [marketSlobodaAdj] слобода [slobodaGenitive]

marketDistrictAdj
  Купеческий ^3
  Торговый ^3
  Рыночный ^2
  Базарный
  Ярмарочный
  Гостиный

marketSlobodaAdj
  Купеческая ^3
  Торговая ^3
  Рыночная ^2
  Базарная
  Ярмарочная

marketGenitive
  Купцов ^3
  Торговцев ^2
  Коробейников
`;
