/**
 * Milvanta Delivery & Hyderabad Pincode System
 * Origin Hub: Hafeezpet, Hyderabad (PIN: 500049)
 * 
 * Rules:
 * - Within 5 kms of Hafeezpet: ₹50 delivery fee (Tier 1)
 * - 6 kms & Core City Range (500001 – 500096): ₹80 delivery fee (Tier 2)
 * - Free delivery on orders ₹499 and above
 * - Pincodes must be within Hyderabad (Core City 500001–500096 + Greater Hyderabad)
 */

(function () {
  'use strict';

  const HUB = {
    name: 'Hafeezpet',
    city: 'Hyderabad',
    state: 'Telangana',
    pincode: '500049',
    freeShippingThreshold: 499
  };

  // Curated Hyderabad Pincode Database with distance from Hafeezpet hub
  const HYDERABAD_PINCODES = {
  "500001": {
    "area": "Abids / Koti / Gunfoundry",
    "shortArea": "Abids",
    "dist": 16,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500002": {
    "area": "Charminar / Old City / Pathergatti",
    "shortArea": "Charminar",
    "dist": 20,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500003": {
    "area": "Secunderabad / Paradise / MG Road",
    "shortArea": "Secunderabad",
    "dist": 15,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500004": {
    "area": "Khairatabad / Lakdikapul / Raj Bhavan",
    "shortArea": "Khairatabad",
    "dist": 12,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500005": {
    "area": "Balkampet / Fatehnagar",
    "shortArea": "Balkampet",
    "dist": 11,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500006": {
    "area": "Karwan / Jiyaguda / Tappachabutra",
    "shortArea": "Karwan",
    "dist": 15,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500007": {
    "area": "Kachiguda / Barkatpura / Nimboliadda",
    "shortArea": "Kachiguda",
    "dist": 18,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500008": {
    "area": "Golconda / Toli Chowki / Langer Houz",
    "shortArea": "Golconda",
    "dist": 13,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500009": {
    "area": "Gagan Mahal / Domalguda",
    "shortArea": "Gagan Mahal",
    "dist": 16,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500010": {
    "area": "Bolarum / Cantonment / Risala Bazar",
    "shortArea": "Bolarum",
    "dist": 18,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500011": {
    "area": "New Bowenpally",
    "shortArea": "Bowenpally",
    "dist": 10,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500012": {
    "area": "Sultan Bazar / Koti / Putlibowli",
    "shortArea": "Sultan Bazar",
    "dist": 17,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500013": {
    "area": "Amberpet / Golnaka / Ali Cafe",
    "shortArea": "Amberpet",
    "dist": 20,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500014": {
    "area": "Tarnaka / Osmania University",
    "shortArea": "Tarnaka",
    "dist": 20,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500015": {
    "area": "Trimulgherry / Kharkhana",
    "shortArea": "Trimulgherry",
    "dist": 16,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500016": {
    "area": "Begumpet / Prakash Nagar",
    "shortArea": "Begumpet",
    "dist": 9.8,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500017": {
    "area": "Malkajgiri / Anandbagh",
    "shortArea": "Malkajgiri",
    "dist": 18,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500018": {
    "area": "Moosapet / Sanath Nagar / Erragadda",
    "shortArea": "Moosapet",
    "dist": 7.5,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500019": {
    "area": "Lingampally / BHEL",
    "shortArea": "Lingampally",
    "dist": 6.2,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500020": {
    "area": "Musheerabad / Gandhi Hospital",
    "shortArea": "Musheerabad",
    "dist": 16,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500021": {
    "area": "Padmarao Nagar / Walker Town",
    "shortArea": "Padmarao Nagar",
    "dist": 16,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500022": {
    "area": "Sanathnagar IE / Czech Colony",
    "shortArea": "Sanathnagar",
    "dist": 11,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500023": {
    "area": "Azamabad / Ramnagar / RTC Kalyana Mandapam",
    "shortArea": "Azamabad",
    "dist": 17,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500024": {
    "area": "Malakpet / Old Malakpet",
    "shortArea": "Malakpet",
    "dist": 20,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500025": {
    "area": "Chikkadpally / RTC X Roads",
    "shortArea": "Chikkadpally",
    "dist": 17,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500026": {
    "area": "Himayatnagar / Street No. 1-15",
    "shortArea": "Himayatnagar",
    "dist": 16,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500027": {
    "area": "Narayanguda / Barkatpura",
    "shortArea": "Narayanguda",
    "dist": 17,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500028": {
    "area": "Mehdipatnam / Masab Tank / Asif Nagar",
    "shortArea": "Mehdipatnam",
    "dist": 13,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500029": {
    "area": "Basheerbagh / Liberty / Hyderguda",
    "shortArea": "Basheerbagh",
    "dist": 16,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500030": {
    "area": "Rajendranagar / Budwel / Agriculture Univ",
    "shortArea": "Rajendranagar",
    "dist": 16,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500031": {
    "area": "Langar Houz / Bapu Ghat",
    "shortArea": "Langar Houz",
    "dist": 14,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500032": {
    "area": "Gachibowli / Financial District",
    "shortArea": "Gachibowli",
    "dist": 5.8,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500033": {
    "area": "Jubilee Hills / Road No. 36-45",
    "shortArea": "Jubilee Hills",
    "dist": 8.8,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500034": {
    "area": "Banjara Hills / Road No. 1-12",
    "shortArea": "Banjara Hills",
    "dist": 9.5,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500035": {
    "area": "Kothapet / Saroornagar / Chaitanyapuri",
    "shortArea": "Kothapet",
    "dist": 24,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500036": {
    "area": "Saidabad Colony / Singareni Colony",
    "shortArea": "Saidabad",
    "dist": 22,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500037": {
    "area": "Balanagar / Ferozguda / Hal Colony",
    "shortArea": "Balanagar",
    "dist": 11,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500038": {
    "area": "SR Nagar / Vengal Rao Nagar",
    "shortArea": "SR Nagar",
    "dist": 9,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500039": {
    "area": "Uppal / Ramanthapur / Survey of India",
    "shortArea": "Uppal",
    "dist": 25,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500040": {
    "area": "Bahadurpura / Nehru Zoological Park",
    "shortArea": "Bahadurpura",
    "dist": 21,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500041": {
    "area": "Shaikpet / Rai Durg",
    "shortArea": "Shaikpet",
    "dist": 8,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500042": {
    "area": "Srinagar Colony / Kamalapuri",
    "shortArea": "Srinagar Colony",
    "dist": 8.5,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500043": {
    "area": "Old Bowenpally / Military Area / Hasmathpet",
    "shortArea": "Bowenpally",
    "dist": 11,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500044": {
    "area": "Vidyanagar / Adikmet / Shivam Road",
    "shortArea": "Vidyanagar",
    "dist": 19,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500045": {
    "area": "Yousufguda / Check Post",
    "shortArea": "Yousufguda",
    "dist": 8.2,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500046": {
    "area": "Nallagandla / Chandanagar BHEL",
    "shortArea": "Nallagandla",
    "dist": 7,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500047": {
    "area": "Alwal / Lothkunta / Old Alwal",
    "shortArea": "Alwal",
    "dist": 18,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500048": {
    "area": "Shamshabad / RGI Airport Colony",
    "shortArea": "Shamshabad",
    "dist": 26,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500049": {
    "area": "Hafeezpet / Miyapur",
    "shortArea": "Hafeezpet",
    "dist": 0.5,
    "tier": 1,
    "fee": 50,
    "serviceable": true
  },
  "500050": {
    "area": "Chanda Nagar / Gangaram",
    "shortArea": "Chanda Nagar",
    "dist": 3.2,
    "tier": 1,
    "fee": 50,
    "serviceable": true
  },
  "500051": {
    "area": "Yapral / Kowkoor / Sainik Nagar",
    "shortArea": "Yapral",
    "dist": 20,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500052": {
    "area": "Ramachandrapuram / BHEL Township",
    "shortArea": "RC Puram",
    "dist": 11,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500053": {
    "area": "Falaknuma / Engine Bowli / Shamsheer Gunj",
    "shortArea": "Falaknuma",
    "dist": 22,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500054": {
    "area": "Jeedimetla / Shapur Nagar / Subhash Nagar",
    "shortArea": "Jeedimetla",
    "dist": 12,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500055": {
    "area": "Quthbullapur / Chintal / Suchitra",
    "shortArea": "Quthbullapur",
    "dist": 11,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500056": {
    "area": "Saidabad / IS Sadan / Madannapet",
    "shortArea": "Saidabad",
    "dist": 22,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500057": {
    "area": "DRDO Complex / Kanchanbagh East",
    "shortArea": "DRDO",
    "dist": 24,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500058": {
    "area": "Kanchanbagh / DMRL / Midhani",
    "shortArea": "Kanchanbagh",
    "dist": 24,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500059": {
    "area": "Santoshnagar / Phoolbagh",
    "shortArea": "Santoshnagar",
    "dist": 24,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500060": {
    "area": "Dilsukhnagar / Moosarambagh / Gaddiannaram",
    "shortArea": "Dilsukhnagar",
    "dist": 22,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500061": {
    "area": "Kattedan / Mailardevpally / Tata Nagar",
    "shortArea": "Kattedan",
    "dist": 21,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500062": {
    "area": "ECIL / Kushaiguda / Kamalanagar",
    "shortArea": "ECIL",
    "dist": 22,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500063": {
    "area": "Madannapet / Kurmaguda",
    "shortArea": "Madannapet",
    "dist": 22,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500064": {
    "area": "Chandrayangutta / Bandlaguda / Barkas",
    "shortArea": "Chandrayangutta",
    "dist": 24,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500065": {
    "area": "Asif Nagar / Mallepally / Vijayanagar Colony",
    "shortArea": "Asif Nagar",
    "dist": 14,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500066": {
    "area": "Serilingampally / Tara Nagar",
    "shortArea": "Serilingampally",
    "dist": 6.5,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500067": {
    "area": "Kompally / Dhulapally / Jeedimetla Village",
    "shortArea": "Kompally",
    "dist": 14,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500068": {
    "area": "Nagole / Mansoorabad / Bandlaguda Nagole",
    "shortArea": "Nagole",
    "dist": 25,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500069": {
    "area": "Osmangunj / Jam Bagh / MJ Market / Moazzam Jahi",
    "shortArea": "Osmangunj",
    "dist": 17,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500070": {
    "area": "Vanasthalipuram / Sachivalaya Nagar",
    "shortArea": "Vanasthalipuram",
    "dist": 28,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500071": {
    "area": "Film Nagar / Jubilee Hills",
    "shortArea": "Film Nagar",
    "dist": 8.5,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500072": {
    "area": "KPHB Colony / Kukatpally Phase 1-6",
    "shortArea": "KPHB Colony",
    "dist": 4.2,
    "tier": 1,
    "fee": 50,
    "serviceable": true
  },
  "500073": {
    "area": "Panjagutta / Somajiguda",
    "shortArea": "Panjagutta",
    "dist": 10,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500074": {
    "area": "LB Nagar / Bairamalguda / Sagar Ring Road",
    "shortArea": "LB Nagar",
    "dist": 26,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500075": {
    "area": "Narsingi / Gandipet / Kokapet",
    "shortArea": "Narsingi",
    "dist": 8.5,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500076": {
    "area": "Nacharam / Mallapur / Industrial Area",
    "shortArea": "Nacharam",
    "dist": 23,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500077": {
    "area": "Shamshabad Rural / Kotwalguda",
    "shortArea": "Shamshabad",
    "dist": 28,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500078": {
    "area": "Cherlapalli / IDA Phase 1-3",
    "shortArea": "Cherlapalli",
    "dist": 24,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500079": {
    "area": "Karmanghat / Champapet / Vaishali Nagar",
    "shortArea": "Karmanghat",
    "dist": 25,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500080": {
    "area": "Domalguda / Ashok Nagar / Indira Park",
    "shortArea": "Domalguda",
    "dist": 17,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500081": {
    "area": "Madhapur / HITEC City",
    "shortArea": "Madhapur",
    "dist": 4.8,
    "tier": 1,
    "fee": 50,
    "serviceable": true
  },
  "500082": {
    "area": "Ameerpet / Dharam Karan Road",
    "shortArea": "Ameerpet",
    "dist": 10,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500083": {
    "area": "Medchal / Gundlapochampally / Kandlakoya",
    "shortArea": "Medchal",
    "dist": 20,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500084": {
    "area": "Kondapur / Kothaguda",
    "shortArea": "Kondapur",
    "dist": 3.5,
    "tier": 1,
    "fee": 50,
    "serviceable": true
  },
  "500085": {
    "area": "Kukatpally / KPHB Phase 7-9",
    "shortArea": "Kukatpally",
    "dist": 6.5,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500086": {
    "area": "NPA / Rajendranagar / Sivaram Pally",
    "shortArea": "Rajendranagar",
    "dist": 16,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500087": {
    "area": "Srinagar Colony / Yellareddyguda / Navodaya",
    "shortArea": "Srinagar Colony",
    "dist": 11,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500088": {
    "area": "Prashanth Nagar / Kukatpally IE",
    "shortArea": "Prashanth Nagar",
    "dist": 4.9,
    "tier": 1,
    "fee": 50,
    "serviceable": true
  },
  "500089": {
    "area": "Manikonda / Puppalguda",
    "shortArea": "Manikonda",
    "dist": 8.2,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500090": {
    "area": "Nizampet / Pragathi Nagar",
    "shortArea": "Nizampet",
    "dist": 4.5,
    "tier": 1,
    "fee": 50,
    "serviceable": true
  },
  "500091": {
    "area": "Attapur / Hyderguda",
    "shortArea": "Attapur",
    "dist": 10,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500092": {
    "area": "Habsiguda / Tarnaka Street 1-8 / Street No 8",
    "shortArea": "Habsiguda",
    "dist": 21,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500093": {
    "area": "Peerzadiguda / Medipally / Parvathapur",
    "shortArea": "Peerzadiguda",
    "dist": 25,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500094": {
    "area": "Sainikpuri / Vayupuri / Defence Colony",
    "shortArea": "Sainikpuri",
    "dist": 22,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500095": {
    "area": "Koti / Bank Street / Troop Bazar",
    "shortArea": "Koti",
    "dist": 17,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500096": {
    "area": "Boduppal / Chengicherla / Mallikarjuna Nagar",
    "shortArea": "Boduppal",
    "dist": 25,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500097": {
    "area": "Meerpet / Jillelguda / Almasguda",
    "shortArea": "Meerpet",
    "dist": 26,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "500098": {
    "area": "Moula Ali / Railway Colony / Housing Board",
    "shortArea": "Moula Ali",
    "dist": 21,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  },
  "502032": {
    "area": "Tellapur / Kollur",
    "shortArea": "Tellapur",
    "dist": 9,
    "tier": 2,
    "fee": 80,
    "serviceable": true
  }
};

  function isHyderabadPincode(pin) {
    if (!pin) return false;
    const clean = String(pin).trim();
    if (!/^\d{6}$/.test(clean)) return false;
    return clean.startsWith('500') || clean === '502032';
  }

  function getDeliveryInfo(pin) {
    const clean = String(pin || '').trim();
    if (!/^\d{6}$/.test(clean)) {
      return {
        valid: false,
        pincode: clean,
        inHyderabad: false,
        serviceable: false,
        area: '',
        shortArea: '',
        distanceKm: null,
        tier: null,
        fee: 50,
        feePaise: 5000,
        message: 'Please enter a valid 6-digit PIN code.'
      };
    }

    const inHyd = isHyderabadPincode(clean);
    if (!inHyd) {
      return {
        valid: true,
        pincode: clean,
        inHyderabad: false,
        serviceable: false,
        area: 'Outside Hyderabad',
        shortArea: 'Outside Hyd',
        distanceKm: null,
        tier: null,
        fee: null,
        feePaise: null,
        message: `Milvanta delivers across Hyderabad (500001–500096). PIN code ${clean} is outside Hyderabad.`
      };
    }

    const mapped = HYDERABAD_PINCODES[clean];
    if (mapped) {
      return {
        valid: true,
        pincode: clean,
        inHyderabad: true,
        serviceable: true,
        area: mapped.area,
        shortArea: mapped.shortArea,
        distanceKm: mapped.dist,
        tier: mapped.tier,
        fee: mapped.fee,
        feePaise: mapped.fee * 100,
        message: `Delivering to ${mapped.area} (~${mapped.dist} km from Hafeezpet hub) · ₹${mapped.fee} delivery fee`
      };
    }

    // Fallback for any other valid 500xxx pin code in Hyderabad
    const pinNum = parseInt(clean, 10);
    const isCoreCity = pinNum >= 500001 && pinNum <= 500096;
    return {
      valid: true,
      pincode: clean,
      inHyderabad: true,
      serviceable: true,
      area: isCoreCity ? 'Hyderabad Core City' : 'Hyderabad Metropolitan Area',
      shortArea: isCoreCity ? 'Hyderabad' : 'Hyderabad',
      distanceKm: 15.0,
      tier: 2,
      fee: 80,
      feePaise: 8000,
      message: `Delivering to ${isCoreCity ? 'Hyderabad Core City' : 'Hyderabad Area'} (${clean}) · ₹80 delivery fee`
    };
  }

  function getHeaderLocationText(pin) {
    const info = getDeliveryInfo(pin);
    if (!info.valid || !info.inHyderabad) return 'Hafeezpet';
    return info.shortArea || 'Hafeezpet';
  }

  const MilvantaDelivery = {
    HUB,
    HYDERABAD_PINCODES,
    isHyderabadPincode,
    getDeliveryInfo,
    getHeaderLocationText
  };

  const scope = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
  if (scope) {
    scope.MilvantaDelivery = MilvantaDelivery;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MilvantaDelivery;
  }
})();
