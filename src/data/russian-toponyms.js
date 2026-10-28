// User-provided Perchance Lists.txt, preserved as data.
export const TOPONYM_SOURCE = String.raw`
placeType = city

output
  [cityName] ^[placeType == "city"]
  [ustCityName] ^[placeType == "ust"]
  [coastCityName] ^[placeType == "coast"]
  [townName] ^[placeType == "town"]
  [seloName] ^[placeType == "selo"]
  [villageName] ^[placeType == "village"]
  [poselokName] ^[placeType == "poselok"]
  [stanitsaName] ^[placeType == "stanitsa"]
  [slobodaName] ^[placeType == "sloboda"]
  [khutorName] ^[placeType == "khutor"]
  [fortressName] ^[placeType == "fortress"]
  [anyName] ^[placeType == "any"]
  [experimentalName] ^[placeType == "experimental"]

anyName
  [cityName] ^4
  [ustCityName] ^2
  [coastCityName] ^2
  [townName] ^3
  [seloName] ^4
  [villageName] ^4
  [poselokName] ^3
  [stanitsaName] ^2
  [slobodaName] ^2
  [khutorName] ^2
  [fortressName] ^1

// ========================================
// 1. ГОРОДА: подбор подходящих морфем
// ========================================
cityName
  [citySkName] ^8
  [prefixCity][citySkName.lowerCase] ^4
  [cityCompound] ^4
  [cityGeographic] ^3
  [cityHydro] ^2
  [ustCityName] ^2
  [coastCityName] ^2
  [cityMemorial] ^1
  [oldTownName] ^1

citySkName
  [rootSk][suffixSk] ^5
  [rootOvsk][suffixOvsk] ^5
  [rootEvsk][suffixEvsk] ^3
  [rootInsk][suffixInsk] ^3
  [rootEnsk][suffixEnsk] ^2
  [rootGorsk][suffixGorsk] ^3

suffixSk
  ск
suffixOvsk
  овск
suffixEvsk
  евск
suffixInsk
  инск
suffixEnsk
  енск
suffixGorsk
  горск

rootSk
  Гор
  Бор
  Озёр
  Камен
  Амур
  Енисей
  Север
  Ангар
  Том
  Иркут
  Мурман
  Яр
  Приозёр
  Заозёр
  Примор
  Нагор
  Подгор

rootOvsk
  Берёз
  Дуб
  Сосн
  Кедр
  Лес
  Луг
  Холм
  Мост
  Пруд
  Руд
  Сол
  Завод
  Покр
  Рыб
  Кузнец
  Орл
  Угл
  Шахт
  Бобр
  Сокол
  Волч
  Ключ

rootEvsk
  Серги
  Алексе
  Андре
  Матве
  Никола
  Кире
  Василь
  Георги
  Тимофе
  Фадде

rootInsk
  Мари
  Лебед
  Сокол
  Волч
  Гус
  Орл
  Катерин
  Пушк
  Бобр
  Ряб
  Кал
  Лис

rootEnsk
  Реч
  Смол
  Благовещ
  Сторож
  Ключ
  Город
  Береж

rootGorsk
  Пяти
  Магнито
  Железно
  Светло
  Тихо
  Злато
  Высоко
  Медно
  Лесо
  Бело
  Красно
  Солнечно

prefixCity
  Ново
  Старо
  Верхне
  Нижне
  Бело
  Красно
  Черно
  Зелено
  Северо
  Южно
  Восточно
  Западно
  Светло
  Тихо
  Мало
  Велико
  Средне
  Перво

cityCompound
  [rootGorod]город ^5
  [rootGrad]град ^5
  [rootPol]поль ^2
  [rootDar]дар ^2
  [rootBurg]бург ^2
  [rootShtadt]штадт ^1
  [rootGof]гоф ^1
  [rootSlavl]славль ^2

rootGorod
  Звени
  Мир
  Слав
  Злато
  Бело
  Красно
  Северо
  Старо
  Выш
  Нов
  Светло
  Волно

rootGrad
  Волго
  Калинин
  Петро
  Красно
  Железно
  Злато
  Миро
  Тихо
  Бело
  Славо
  Черно
  Светло
  Ново

rootPol
  Севасто
  Ставро
  Симферо
  Нико
  Мариу
  Терно
  Славо
  Ново
  Миро

rootDar
  Красно
  Бого
  Миро
  Славо
  Волго
  Светло
  Злато
  Добро

rootBurg
  Екатерин
  Орен
  Петер
  Александр
  Фридрих
  Крон
  Никола
  Елизавет

rootShtadt
  Крон
  Фридрих
  Петер
  Александр
  Розен

rootGof
  Петер
  Мариен
  Александер
  Розен

rootSlavl
  Яро
  Мсти
  Пере
  Бори
  Рости
  Вяче

cityGeographic
  Приозёрск
  Подгорск
  Зареченск
  Междуреченск
  Нагорск
  Заозёрск
  Приморск
  Среднеуральск
  Северодвинск
  Южноуральск
  Заречье
  Залесье
  Заозёрье
  Приозёрье
  Пятигорск

cityHydro
  [ustCityName] ^4
  Верх-[riverName] ^1
  Нижне-[riverStem]ск ^1

riverName
  Илим
  Луга
  Каменка
  Кедровка
  Белая
  Чёрная
  Сосна
  Тура
  Уда
  Ока
  Лена
  Волга
  Нера
  Черемша
  Белозёрка

riverStem
  Илим
  Камен
  Уд
  Лен
  Тур
  Нер
  Луж
  Черемш

// ========================================
// 1а. УСТЬЕВЫЕ ГОРОДА: Усть- + гидроним
// Отдельная категория "ust". Все её результаты
// начинаются с «Усть-». Эти названия привязаны
// к реке или её устью, не обязательно к морю.
// ========================================
ustCityName
  Усть-[ustRiverName] ^8
  Усть-[ustSkStem]ск ^5
  Усть-[ustOvskStem]овск ^2

// Цельные гидронимы. Не изменяйте окончания без
// проверки: прилагательные и названия рек должны
// оставаться самостоятельными словами.
ustRiverName
  Илим
  Кут
  Лаба
  Катав
  Абакан
  Омчуг
  Цильма
  Луга
  Нера
  Тура
  Уда
  Ока
  Лена
  Волга
  Сура
  Сылва
  Чусовая
  Ижора
  Клязьма
  Ветлуга
  Каменка
  Кедровка
  Берёзовка
  Черемша
  Белая
  Чёрная
  Быстрая
  Тихая
  Ключевая
  Студёнка
  Серебрянка
  Медведица
  Сосна
  Ольха
  Боровая
  Лебяжья
  Лисица
  Рассоха
  Песчанка
  Речица
  Озёрка
  Дубровка
  Осиновка
  Липовка
  Чернушка
  Бобровка
  Рябиновка
  Луговая
  Полуденная
  Воронья
  Зимняя
  Талица
  Понура
  Елань
  Ница
  Иртыш
  Томь
  Ангара
  Енисей

ustSkStem
  Илим
  Лабин
  Удин
  Нерин
  Катав
  Амур
  Сур
  Камен
  Кедров
  Боров
  Черемшин
  Бобров
  Луж
  Озёр
  Ижор
  Ветлуж
  Талиц

ustOvskStem
  Берёз
  Сосн
  Дуб
  Кедр
  Бобр
  Луг
  Лес
  Мост
  Пруд
  Холм
  Камен
  Руд
  Орл
  Ключ

// ========================================
// 1б. ПРИБРЕЖНЫЕ ГОРОДА — море, залив, порт,
// остров, мыс, берег; никаких обязательных «Усть-».
// Устьевые города описаны ОТДЕЛЬНО выше.
// Названия для бухт/мысов больше характерны для
// посёлков, поэтому у них меньший вес.
// ========================================
coastCityName
  [coastMorskName] ^9
  [coastSkName] ^6
  [coastPortName] ^3
  [coastBayName] ^2
  [coastShoreName] ^2
  [coastAdjectiveName] ^1

coastMorskName
  [coastMorskPrefix]морск

coastMorskPrefix
  Бело
  Черно
  Северо
  Южно
  Ново
  Старо
  Красно
  Светло
  Зелено
  Тихо
  Дальне
  Восточно
  Западно
  Средне
  Серебряно

coastSkName
  [coastSimpleSkStem]ск ^6
  [coastOvskStem]овск ^4
  [coastInskStem]инск ^2
  [coastGorskPrefix]горск ^2
  [coastOzerskPrefix]озёрск ^1

coastSimpleSkStem
  Примор
  Балтий
  Помор
  Остров
  Залив
  Утёс
  Пристан
  Маяк
  Порт
  Берег
  Приозёр
  Пролив
  Камыш
  Песчан
  Шторм
  Рыбац

coastOvskStem
  Берег
  Остров
  Маяк
  Моряк
  Рыбак
  Якор
  Шторм
  Утёс
  Камыш
  Парус
  Порт
  Бухт
  Скал
  Риф
  Сосен
  Кедр

coastInskStem
  Гаван
  Пристан
  Риф
  Песчан
  Скал
  Мор
  Бухт

coastGorskPrefix
  Светло
  Зелено
  Красно
  Бело
  Солнечно
  Высоко

coastOzerskPrefix
  При
  За
  Бело
  Красно
  Светло
  Ново

coastPortName
  [coastPortPrefix]порт ^4
  [coastPortAdjective] Порт ^3
  Порт-[coastPortSecond] ^1

coastPortPrefix
  Ново
  Старо
  Северо
  Южно
  Восточно
  Западно
  Бело
  Красно
  Дальне
  Светло

coastPortAdjective
  Новый
  Старый
  Северный
  Южный
  Восточный
  Западный
  Белый
  Красный
  Дальний
  Светлый
  Тихий
  Большой
  Рыбацкий
  Торговый

coastPortSecond
  Камень
  Сокол
  Кедров
  Берёзов
  Рудный
  Северный
  Южный
  Восточный
  Рыбачий
  Остров
  
coastBayName
  [coastBayAdjective] Бухта ^3
  [coastBayAdjective] Гавань ^3
  [coastBayAdjective] Пристань ^2
  Бухта [coastBayGenitive] ^2

coastBayAdjective
  Тихая
  Светлая
  Зелёная
  Лазурная
  Северная
  Южная
  Дальняя
  Белая
  Красная
  Каменная
  Песчаная
  Глубокая
  Серебряная
  Сосновая
  Кедровая
  Рыбацкая
  Новая
  Старая

coastBayGenitive
  Ветров
  Скалы
  Сокола
  Медведя
  Туманов
  Кораблей
  Парусов
  Солнца
  Лебедей
  Кедров
  Рыбаков
  Чаек
  Якорей

coastShoreName
  [coastShoreAdjective] Берег ^4
  [coastShoreAdjective] Мыс ^3
  [coastBayAdjective] Коса ^2
  [coastBayAdjective] Заводь ^1

coastShoreAdjective
  Белый
  Красный
  Чёрный
  Северный
  Южный
  Восточный
  Западный
  Новый
  Старый
  Дальний
  Светлый
  Тихий
  Высокий
  Каменный
  Сосновый
  Рыбацкий
  Песчаный
  Зелёный

coastAdjectiveName
  Приморский
  Прибрежный
  Береговой
  Морской
  Портовый
  Островной
  Заливный
  Маячный
  Приозёрный
  Озёрный
  Приморское
  Прибрежное
  Морское
  Рыбачье

cityMemorial
  Кировск
  Ленинск
  Пушкин
  Жуковск
  Мариинск
  Николаевск
  Сергиевск
  Первомайск
  Октябрьск
  Калининск
  Александровск
  Георгиевск

// ========================================
// 2. МАЛЫЕ ГОРОДА
// ========================================
townName
  [oldTownName] ^4
  [smallTownSuffix] ^3
  [citySkName] ^4
  [townPrefix][smallTownSuffix.lowerCase] ^2
  [cityGeographic] ^2

oldTownName
  [rootOv]ов
  [rootEv]ев
  [rootIn]ин
  [rootEts]ец
  [rootOk]ок
  [rootIshche]ище
  [rootItsy]ицы

rootOv
  Рост
  Тамб
  Глеб
  Сокол
  Захар
  Дуб
  Камен
  Орл
  Борис

rootEv
  Серге
  Иса
  Васил
  Матве
  Кире
  Андре
  Алексе

rootIn
  Пушк
  Клим
  Сокол
  Гус
  Ряб
  Бобр
  Дуб

rootEts
  Город
  Камен
  Бережен
  Бор
  Лес
  Лип
  Сосен
  Руден

rootOk
  Торж
  Дуб
  Лес
  Луж
  Береж
  Город

rootIshche
  Город
  Сел
  Двор
  Погост

rootItsy
  Луж
  Бел
  Камен
  Пустош
  Руд

smallTownSuffix
  [rootEts]ец
  [rootOk]ок
  [rootOvsk]овск
  [rootInsk]инск
  [rootIn]ин
  [rootOv]ов

townPrefix
  Ново
  Старо
  Верхне
  Нижне
  Бело
  Красно
  Мало

// ========================================
// 3. СЁЛА
// ========================================
seloName
  [seloPlain] ^8
  [prefixSelo][seloPlain.lowerCase] ^2
  [religiousSelo] ^3
  [seloTopographic] ^2

seloPlain
  [rootOvo]ово ^5
  [rootEvo]ево ^3
  [rootYovo]ёво ^2
  [rootIno]ино ^5
  [rootYno]ыно ^1
  [rootOvskoe]овское ^2

rootOvo
  Иван
  Дуб
  Берёз
  Кедр
  Камен
  Сокол
  Медвед
  Волк
  Павл
  Захар
  Мороз
  Пруд
  Лесн

rootEvo
  Марь
  Горел
  Матве
  Серге
  Кире
  Андре
  Алексе
  Никола
  Фадде

rootYovo
  Бирюл
  Кисел
  Корол
  Осин

rootIno
  Марь
  Бород
  Ольг
  Иль
  Лебяж
  Волч
  Тиш
  Ряб
  Гус
  Дуб
  Лип
  Кал
  Покров
  Троиц

rootYno
  Голиц
  Куриц
  Лисиц
  Бориц

rootOvskoe
  Покр
  Сокол
  Орл
  Дуб
  Мороз
  Кедр
  Берёз

religiousSelo
  Никольское
  Покровское
  Троицкое
  Спасское
  Рождественское
  Благовещенское
  Богородское
  Архангельское
  Воскресенское
  Успенское
  Преображенское
  Михайловское
  Георгиевское
  Дмитриевское
  Крестовоздвиженское

seloTopographic
  Заречье
  Залесье
  Подгорье
  Нагорье
  Приозёрье
  Междуречье
  Заозёрье
  Подлесье
  Прилуки
  Подберезье
  Луговое
  Лесное
  Озёрное
  Степное

prefixSelo
  Ново
  Старо
  Верхне
  Нижне
  Бело
  Красно
  Мало
  Велико

// ========================================
// 4. ДЕРЕВНИ
// ========================================
villageName
  [villagePlain] ^8
  [prefixVillage][villagePlain.lowerCase] ^2
  [seloPlain] ^2
  [seloTopographic] ^2

villagePlain
  [rootKa]ка ^4
  [rootOvka]овка ^5
  [rootEvka]евка ^3
  [rootInka]инка ^2
  [rootKi]ки ^2
  [rootIshche]ище ^1

rootKa
  Камен
  Берёз
  Лип
  Реч
  Рябин
  Малин
  Гор
  Луж
  Сосен
  Глин
  Дубрав

rootOvka
  Берёз
  Сосн
  Дуб
  Кедр
  Лес
  Луг
  Камен
  Руд
  Лип
  Осин
  Сокол
  Волч
  Рыб
  Пруд
  Мост
  Мороз
  Груш
  Рябин

rootEvka
  Серге
  Алексе
  Андре
  Матве
  Никола
  Кире
  Василь
  Георги
  Тимофе

rootInka
  Марь
  Дуб
  Ос
  Ряб
  Кал
  Гус
  Лис
  Мал
  Реч

rootKi
  Берёз
  Дуб
  Лип
  Сосен
  Рябин
  Луж
  Гус
  Волч
  Озёр
  Камен

prefixVillage
  Ново
  Старо
  Верхне
  Нижне
  Бело
  Красно
  Мало
  Велико

// ========================================
// 5. ПОСЁЛКИ
// ========================================
poselokName
  [poselokAdj] ^8
  [poselokIndustry] ^3
  [seloTopographic] ^2
  [poselokCompound] ^2

poselokAdj
  Берёзовый
  Сосновый
  Лесной
  Кедровый
  Рудный
  Шахтёрский
  Степной
  Приозёрный
  Подгорный
  Заречный
  Северный
  Южный
  Восточный
  Западный
  Новый
  Старый
  Красный
  Белый
  Тихий
  Дальний
  Мирный
  Светлый
  Высокий
  Полевой
  Озёрный
  Каменный
  Луговой
  Родниковый
  Солнечный
  Ясный
  Зелёный
  Горный
  Привольный
  Прибрежный
  Рабочий
  Станционный

poselokIndustry
  Рудозаводский
  Лесозаводский
  Железнодорожный
  Нефтяной
  Угольный
  Шахтный
  Солеваренный
  Заводской
  Приисковый
  Кирпичный
  Стекольный
  Металлургический
  Мостострой
  Энергетик
  Геологический

poselokCompound
  Красный Бор
  Белые Ключи
  Новый Путь
  Старый Мост
  Зелёный Луг
  Тихий Дол
  Сосновый Бор
  Дальний Яр
  Светлая Поляна
  Первое Мая
  Новый Свет
  Красная Заря

// ========================================
// 6. СТАНИЦЫ
// ========================================
stanitsaName
  [stanitsaAdj] ^8
  [stanitsaPrefix][stanitsaAdj.lowerCase] ^3

stanitsaAdj
  Каменская
  Берёзовская
  Дубовская
  Луговская
  Орловская
  Северская
  Донская
  Озёрская
  Покровская
  Николаевская
  Староминская
  Привольная
  Тихорецкая
  Степная
  Высокая
  Курганная
  Сосновская
  Лесная
  Рудная
  Родниковская
  Залесская
  Приозёрская
  Чернореченская
  Заречная
  Липовская
  Холмская

stanitsaPrefix
  Ново
  Старо
  Верхне
  Нижне
  Мало
  Красно

// ========================================
// 7. СЛОБОДЫ
// ========================================
slobodaName
  [slobodaAdj] слобода ^6
  Слобода [slobodaGenitive] ^2
  [slobodaAdj] ^2

slobodaAdj
  Покровская
  Никольская
  Троицкая
  Красная
  Старая
  Новая
  Берёзовая
  Сосновая
  Дубовая
  Стрелецкая
  Кузнецкая
  Ямская
  Рыбацкая
  Торговая
  Солдатская
  Пушкарская
  Рудная
  Заречная
  Верхняя
  Нижняя
  Благовещенская
  Михайловская
  Спасская

slobodaGenitive
  Кузнецов
  Стрельцов
  Рыбаков
  Ямщиков
  Купцов
  Пушкарей
  Гончаров
  Плотников
  Рудокопов
  Лесорубов

// ========================================
// 8. ХУТОРА
// ========================================
khutorName
  [khutorAdj] [khutorNoun.lowerCase] ^6
  [khutorPersonal] ^2
  [poselokAdj] ^2

khutorAdj
  Белый
  Чёрный
  Красный
  Зелёный
  Новый
  Старый
  Дальний
  Ближний
  Тихий
  Глухой
  Высокий
  Низкий
  Сухой
  Каменный
  Сосновый
  Дубовый
  Лисий
  Медвежий
  Волчий
  Кривой
  Степной

khutorNoun
  Ключ
  Яр
  Луг
  Бор
  Брод
  Курган
  Колодец
  Овраг
  Мост
  Лес
  Пруд
  Холм
  Перевал
  Дол
  Камень

khutorPersonal
  Ивановский
  Кузнецовский
  Матвеевский
  Корнеевский
  Захаровский
  Орловский
  Павловский
  Сергиевский
  Андреевский

// ========================================
// 9. КРЕПОСТИ / ОСТРОГИ
// ========================================
fortressName
  [fortressAdj] острог ^5
  [fortressFemAdj] крепость ^4
  [fortressAdj] городок ^2
  [fortressFemAdj] застава ^2
  [cityCompound] ^1

fortressAdj
  Каменный
  Белый
  Красный
  Северный
  Восточный
  Западный
  Южный
  Высокий
  Тихий
  Железный
  Деревянный
  Пограничный
  Сторожевой
  Залесский
  Озёрный
  Таёжный
  Горный
  Верхний
  Нижний

fortressFemAdj
  Каменная
  Белая
  Красная
  Северная
  Восточная
  Западная
  Южная
  Высокая
  Тихая
  Железная
  Деревянная
  Пограничная
  Сторожевая
  Залесская
  Озёрная
  Таёжная
  Горная
  Верхняя
  Нижняя

// ========================================
// 10. ПОЛНЫЙ СЛОВАРЬ МОРФЕМ
// Свободная сборка. Она экспериментальная:
// отдельные сочетания будут искусственными.
// ========================================
experimentalName
  [experimentalPrefix][experimentalRoot][experimentalEnding] ^3
  [experimentalRoot.titleCase][experimentalEnding] ^2

experimentalPrefix
  [prefAge]
  [prefHeight]
  [prefDirection]
  [prefColor]
  [prefSize]
  [prefQuality]
  [prefOrder]
  [prefReligious]
  [prefSpatial]

prefAge
  Ново
  Старо

prefHeight
  Верхне
  Нижне
  Средне

prefDirection
  Северо
  Южно
  Восточно
  Западно

prefColor
  Бело
  Красно
  Черно
  Зелено
  Сине

prefSize
  Велико
  Мало
  Большо

prefQuality
  Светло
  Тихо
  Добро
  Ясно

prefOrder
  Перво
  Второ
  Трёх
  Пяти

prefReligious
  Свято
  Бого
  Благовещен

prefSpatial
  За
  При
  Под
  На
  Между
  Усть-
  Средне

experimentalRoot
  [rootsForest]
  [rootsTrees]
  [rootsRelief]
  [rootsWater]
  [rootsTerrain]
  [rootsAnimals]
  [rootsWeather]
  [rootsIndustry]
  [rootsTrade]
  [rootsTransport]
  [rootsDefense]
  [rootsSettlements]
  [rootsReligion]
  [rootsAncient]

rootsForest
  лес
  бор
  рощ
  чащ
  дубрав

rootsTrees
  берёз
  дуб
  сосн
  кедр
  лип
  осин
  ель

rootsRelief
  гор
  холм
  яр
  дол
  крут
  камен
  скал

rootsWater
  реч
  озёр
  пруд
  вод
  ключ
  руч
  родник

rootsTerrain
  пол
  луг
  степ
  болот
  низин
  пустош

rootsAnimals
  медвед
  волч
  лис
  сокол
  орл
  лебед
  бобр

rootsWeather
  ветр
  солнц
  зар
  мороз
  снеж
  гроз

rootsIndustry
  завод
  руд
  шахт
  угл
  желез
  медн
  солев

rootsTrade
  торг
  купец
  базар
  ярмарк
  гостин

rootsTransport
  мост
  брод
  перевоз
  волок
  ям
  пут

rootsDefense
  креп
  острог
  страж
  застав
  город

rootsSettlements
  посад
  сел
  деревн
  слобод
  починок

rootsReligion
  крест
  покров
  троиц
  никол
  спас
  богород

rootsAncient
  слав
  мир
  люб
  яр
  влад
  выш

experimentalEnding
  [endCity]
  [endPossessive]
  [endVillage]
  [endCompound]

endCity
  ск
  овск
  евск
  инск
  енск

endPossessive
  ов
  ев
  ин
  ово
  ево
  ино
  ыно

endVillage
  ка
  овка
  евка
  инка
  ки
  ище
  ье
  ицы

endCompound
  город
  град
  горск
  поль
  дар
  бург
  штадт
  гоф
  славль
`;
