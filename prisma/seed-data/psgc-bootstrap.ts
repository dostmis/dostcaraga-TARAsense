// Bootstrap PSGC dataset: 17 regions + all 82 Philippine provinces.
// Codes follow the 10-digit PSGC standard (rrPP000000 for provinces).
// Cities and barangays must be supplied via prisma/seed-data/psgc.json
// (see prisma/seed-psgc.ts) — this file is a deterministic fallback so that
// region/province dropdowns always work even before a full dump is loaded.

export type BootstrapRegion = {
  code: string;
  name: string;
  shortName: string;
  provinces: Array<{ code: string; name: string }>;
};

export const BOOTSTRAP_REGIONS: BootstrapRegion[] = [
  {
    code: "0100000000",
    name: "Region I – Ilocos Region",
    shortName: "Ilocos",
    provinces: [
      { code: "0102800000", name: "Ilocos Norte" },
      { code: "0102900000", name: "Ilocos Sur" },
      { code: "0103300000", name: "La Union" },
      { code: "0105500000", name: "Pangasinan" },
    ],
  },
  {
    code: "0200000000",
    name: "Region II – Cagayan Valley",
    shortName: "Cagayan Valley",
    provinces: [
      { code: "0200900000", name: "Batanes" },
      { code: "0201500000", name: "Cagayan" },
      { code: "0203100000", name: "Isabela" },
      { code: "0205000000", name: "Nueva Vizcaya" },
      { code: "0205700000", name: "Quirino" },
    ],
  },
  {
    code: "0300000000",
    name: "Region III – Central Luzon",
    shortName: "Central Luzon",
    provinces: [
      { code: "0300800000", name: "Aurora" },
      { code: "0301400000", name: "Bataan" },
      { code: "0301900000", name: "Bulacan" },
      { code: "0304900000", name: "Nueva Ecija" },
      { code: "0305400000", name: "Pampanga" },
      { code: "0306900000", name: "Tarlac" },
      { code: "0307100000", name: "Zambales" },
    ],
  },
  {
    code: "0400000000",
    name: "Region IV-A – CALABARZON",
    shortName: "CALABARZON",
    provinces: [
      { code: "0401000000", name: "Batangas" },
      { code: "0402100000", name: "Cavite" },
      { code: "0403400000", name: "Laguna" },
      { code: "0405600000", name: "Quezon" },
      { code: "0405800000", name: "Rizal" },
    ],
  },
  {
    code: "1700000000",
    name: "Region IV-B – MIMAROPA",
    shortName: "MIMAROPA",
    provinces: [
      { code: "1705100000", name: "Marinduque" },
      { code: "1705200000", name: "Occidental Mindoro" },
      { code: "1705300000", name: "Oriental Mindoro" },
      { code: "1705900000", name: "Palawan" },
      { code: "1706000000", name: "Romblon" },
    ],
  },
  {
    code: "0500000000",
    name: "Region V – Bicol Region",
    shortName: "Bicol",
    provinces: [
      { code: "0500500000", name: "Albay" },
      { code: "0501600000", name: "Camarines Norte" },
      { code: "0501700000", name: "Camarines Sur" },
      { code: "0502000000", name: "Catanduanes" },
      { code: "0504100000", name: "Masbate" },
      { code: "0506200000", name: "Sorsogon" },
    ],
  },
  {
    code: "0600000000",
    name: "Region VI – Western Visayas",
    shortName: "Western Visayas",
    provinces: [
      { code: "0600400000", name: "Aklan" },
      { code: "0600600000", name: "Antique" },
      { code: "0601900000", name: "Capiz" },
      { code: "0603000000", name: "Iloilo" },
      { code: "0604500000", name: "Negros Occidental" },
      { code: "0607900000", name: "Guimaras" },
    ],
  },
  {
    code: "1800000000",
    name: "Region VII – Central Visayas",
    shortName: "Central Visayas",
    provinces: [
      { code: "0701200000", name: "Bohol" },
      { code: "0702200000", name: "Cebu" },
      { code: "1804600000", name: "Negros Oriental" },
      { code: "0706100000", name: "Siquijor" },
    ],
  },
  {
    code: "0800000000",
    name: "Region VIII – Eastern Visayas",
    shortName: "Eastern Visayas",
    provinces: [
      { code: "0802600000", name: "Biliran" },
      { code: "0803700000", name: "Eastern Samar" },
      { code: "0804800000", name: "Leyte" },
      { code: "0806000000", name: "Northern Samar" },
      { code: "0806400000", name: "Samar" },
      { code: "0807800000", name: "Southern Leyte" },
    ],
  },
  {
    code: "0900000000",
    name: "Region IX – Zamboanga Peninsula",
    shortName: "Zamboanga Peninsula",
    provinces: [
      { code: "0907200000", name: "Zamboanga del Norte" },
      { code: "0907300000", name: "Zamboanga del Sur" },
      { code: "0908300000", name: "Zamboanga Sibugay" },
    ],
  },
  {
    code: "1000000000",
    name: "Region X – Northern Mindanao",
    shortName: "Northern Mindanao",
    provinces: [
      { code: "1001300000", name: "Bukidnon" },
      { code: "1001800000", name: "Camiguin" },
      { code: "1003500000", name: "Lanao del Norte" },
      { code: "1004200000", name: "Misamis Occidental" },
      { code: "1004300000", name: "Misamis Oriental" },
    ],
  },
  {
    code: "1100000000",
    name: "Region XI – Davao Region",
    shortName: "Davao",
    provinces: [
      { code: "1102300000", name: "Davao de Oro" },
      { code: "1102400000", name: "Davao del Norte" },
      { code: "1102500000", name: "Davao del Sur" },
      { code: "1108200000", name: "Davao Oriental" },
      { code: "1108600000", name: "Davao Occidental" },
    ],
  },
  {
    code: "1200000000",
    name: "Region XII – SOCCSKSARGEN",
    shortName: "SOCCSKSARGEN",
    provinces: [
      { code: "1204700000", name: "Cotabato" },
      { code: "1206300000", name: "South Cotabato" },
      { code: "1206500000", name: "Sultan Kudarat" },
      { code: "1208000000", name: "Sarangani" },
    ],
  },
  {
    code: "1300000000",
    name: "National Capital Region",
    shortName: "NCR",
    provinces: [
      // NCR has no provinces; we model NCR as a pseudo-province so cascading still works.
      { code: "1300000000", name: "Metro Manila" },
    ],
  },
  {
    code: "1400000000",
    name: "Cordillera Administrative Region",
    shortName: "CAR",
    provinces: [
      { code: "1401100000", name: "Abra" },
      { code: "1402700000", name: "Benguet" },
      { code: "1403600000", name: "Ifugao" },
      { code: "1403200000", name: "Kalinga" },
      { code: "1404400000", name: "Mountain Province" },
      { code: "1408100000", name: "Apayao" },
    ],
  },
  {
    code: "1900000000",
    name: "Bangsamoro Autonomous Region in Muslim Mindanao",
    shortName: "BARMM",
    provinces: [
      { code: "1903800000", name: "Basilan" },
      { code: "1903500000", name: "Lanao del Sur" },
      { code: "1904000000", name: "Maguindanao del Norte" },
      { code: "1904100000", name: "Maguindanao del Sur" },
      { code: "1906600000", name: "Sulu" },
      { code: "1907000000", name: "Tawi-Tawi" },
    ],
  },
  {
    code: "1600000000",
    name: "Region XIII – Caraga",
    shortName: "Caraga",
    provinces: [
      { code: "1606700000", name: "Agusan del Norte" },
      { code: "1606800000", name: "Agusan del Sur" },
      { code: "1608500000", name: "Surigao del Norte" },
      { code: "1608600000", name: "Surigao del Sur" },
      { code: "1608700000", name: "Dinagat Islands" },
    ],
  },
];
