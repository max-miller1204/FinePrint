// Writes the `lease-synthetic` eval set (spec §12, #20): one realistic
// 12-page Virginia lease with the 8 planted violations, and 2 clean variants.
//
//   node scripts/make-synthetic-lease.ts            # writes eval/datasets/lease-synthetic/
//   node scripts/make-synthetic-lease.ts --check    # exits 1 when the files are out of date
//
// Output, all committed:
//   eval/datasets/lease-synthetic/planted.txt     the 8 plants (spec §12)
//   eval/datasets/lease-synthetic/clean.txt       the same lease, each plant fixed
//   eval/datasets/lease-synthetic/clean-alt.txt   other parties and amounts, compliant
//                                                 wording close to each plant
//   eval/datasets/lease-synthetic.jsonl           one line per lease: the findings it
//                                                 should get (rule, clause heading, severity)
//
// The plants: a 3-month deposit, a 15% late fee, 24 hours' notice for routine
// entry (code, S4), and a rights waiver, a confession of judgment, landlord
// exculpation, tenant-paid HVAC repairs, and attorney fees (Gemma, S5 and
// S7). Every other clause follows the rule pack (jurisdictions/va), so any
// other unenforceable or ask finding is a false positive. Clauses that
// change on a date during the term (casualty notice, renewal notice) cite
// the statute instead of a number of days. The text is placeholder-redacted
// the way the device sends it ([TENANT_NAME], [ADDRESS]).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export type Variant = 'planted' | 'clean' | 'clean-alt';
type Severity = 'unenforceable' | 'ask';

interface Plant {
  ruleId: string;
  severity: Severity;
  text: Record<Variant, string>;
}

interface Section {
  title: string;
  // A planted section's body comes from its plant.
  body: string | Plant;
}

interface Parties {
  date: string;
  landlord: string;
  short: string;
  city: string;
  unit: string;
  rent: string;
}

const PARTIES: Record<Variant, Parties> = {
  planted: { date: 'October 15, 2026', landlord: 'Blue Ridge Property Management, LLC', short: 'Blue Ridge', city: 'Richmond', unit: 'Apartment 3B', rent: '$1,500.00' },
  clean: { date: 'October 15, 2026', landlord: 'Blue Ridge Property Management, LLC', short: 'Blue Ridge', city: 'Richmond', unit: 'Apartment 3B', rent: '$1,500.00' },
  'clean-alt': { date: 'October 12, 2026', landlord: 'Tidewater Residential Partners, LLC', short: 'Tidewater', city: 'Norfolk', unit: 'Unit 214', rent: '$1,650.00' },
};

export const PLANTS = {
  deposit: {
    ruleId: 'VA_DEPOSIT_CAP',
    severity: 'unenforceable',
    text: {
      planted: "Before moving in, Tenant shall pay a security deposit of $4,500.00 (three months' rent).",
      clean: "Before moving in, Tenant shall pay a security deposit of $1,500.00 (one month's rent).",
      'clean-alt': 'Before moving in, Tenant shall pay a security deposit of $2,475.00.',
    },
  },
  lateFee: {
    ruleId: 'VA_LATE_FEE_CAP',
    severity: 'unenforceable',
    text: {
      planted: 'If rent is not received by 5:00 p.m. on the fifth (5th) day of the month, Tenant shall pay a late charge equal to fifteen percent (15%) of the monthly rent.',
      clean: 'If rent is not received by 5:00 p.m. on the fifth (5th) day of the month, Tenant shall pay a late charge equal to five percent (5%) of the monthly rent.',
      'clean-alt': 'If rent is not received by 5:00 p.m. on the fifth (5th) day of the month, Tenant shall pay a late charge of $80.00.',
    },
  },
  entry: {
    ruleId: 'VA_ROUTINE_MAINTENANCE_NOTICE_72H',
    severity: 'unenforceable',
    text: {
      planted: "Landlord may enter the Premises to perform routine maintenance that Tenant has not requested upon twenty-four (24) hours' notice to Tenant.",
      clean: "Landlord may enter the Premises to perform routine maintenance that Tenant has not requested upon seventy-two (72) hours' notice to Tenant.",
      'clean-alt': "For routine maintenance that Tenant has not requested, Landlord will give Tenant at least seventy-two (72) hours' notice before entering.",
    },
  },
  hvac: {
    ruleId: 'VA_LANDLORD_MAINTAIN_FIT',
    // The rule's severityIfViolated is `ask`, so even a verifier agreement reads as ask.
    severity: 'ask',
    text: {
      planted:
        'Tenant shall be responsible for all repairs to the heating, ventilation, and air-conditioning systems, including service calls, parts, and replacement of any unit that fails during the term, regardless of the cause.',
      clean:
        'Landlord shall maintain the heating, ventilation, and air-conditioning systems, the plumbing, the electrical system, and every appliance Landlord supplies in good and safe working order, and shall pay for their repair and replacement.',
      'clean-alt':
        'Landlord is responsible for keeping the heating and air-conditioning system, water heater, plumbing, wiring, and the supplied appliances in good and safe working order. Tenant shall pay only for a repair made necessary by damage that Tenant, an occupant, or a guest caused.',
    },
  },
  exculpation: {
    ruleId: 'VA_NO_EXCULPATION_INDEMNITY',
    severity: 'unenforceable',
    text: {
      planted:
        'Landlord shall not be liable to Tenant, occupants, or guests for any injury, loss, or damage to persons or property, from any cause whatsoever, including the negligence of Landlord or its agents, and Tenant shall indemnify and hold Landlord harmless from all such claims.',
      clean:
        "Each party is responsible for injury, loss, or damage caused by its own negligence or by its failure to meet its duties under this Lease or under Virginia law. Landlord does not insure Tenant's personal property.",
      'clean-alt':
        "Tenant is responsible for damage to the Premises caused by Tenant, occupants, or guests, beyond reasonable wear and tear. Landlord remains responsible for injury or loss caused by Landlord's negligence or by its failure to perform its duties under the law.",
    },
  },
  waiver: {
    ruleId: 'VA_NO_RIGHTS_WAIVER',
    severity: 'unenforceable',
    text: {
      planted:
        'Tenant waives all rights and remedies Tenant may have under the Virginia Residential Landlord and Tenant Act, including any right to a jury trial, to the fullest extent this waiver is allowed.',
      clean:
        'This Lease is governed by the Virginia Residential Landlord and Tenant Act. Nothing in this Lease takes away any right or remedy that Tenant or Landlord has under the Act.',
      'clean-alt':
        "This Lease is subject to the Virginia Residential Landlord and Tenant Act. If any term of this Lease conflicts with the Act, the Act controls, and Tenant keeps every right and remedy the Act gives Tenant.",
    },
  },
  confession: {
    ruleId: 'VA_NO_CONFESSION_OF_JUDGMENT',
    severity: 'unenforceable',
    text: {
      planted:
        'Tenant hereby authorizes any attorney chosen by Landlord to appear for Tenant in any court and confess judgment against Tenant for all rent, charges, and damages due under this Lease, without notice to Tenant.',
      clean:
        'Landlord may seek a money judgment against Tenant only by filing a lawsuit, with notice to Tenant and an opportunity for Tenant to be heard. Tenant may appear and defend any such lawsuit.',
      'clean-alt':
        'Any claim for money owed under this Lease must be brought in the general district court for the city where the Premises are located. Each party will receive notice of the claim and may present its side before any judgment is entered.',
    },
  },
  attorneyFees: {
    ruleId: 'VA_NO_LANDLORD_ATTORNEY_FEES',
    severity: 'unenforceable',
    text: {
      planted:
        "Tenant shall pay all of Landlord's attorney fees, court costs, and collection costs incurred in connection with this Lease or Tenant's occupancy, whether or not a lawsuit is filed and whatever its outcome.",
      clean: 'Each party shall pay its own attorney fees, except as the Virginia Residential Landlord and Tenant Act provides otherwise.',
      'clean-alt': 'Attorney fees may be awarded only as provided in the Virginia Residential Landlord and Tenant Act. Otherwise, each party pays its own attorney fees.',
    },
  },
} satisfies Record<string, Plant>;

function sections(v: Variant): Section[] {
  const p = PARTIES[v];
  const alt = v === 'clean-alt';
  return [
    {
      title: 'PREMISES',
      body: `Landlord leases to Tenant, and Tenant leases from Landlord, the dwelling unit located at [ADDRESS], ${p.unit}, ${p.city}, Virginia (the "Premises"), together with the appliances listed in the Move-In Inspection Report: refrigerator, range, dishwasher, microwave, and stacked washer and dryer. The Premises include the use of one storage closet on the same floor, the shared laundry room, the fitness room, and the other common areas of the community, subject to the community rules.`,
    },
    {
      title: 'DEFINITIONS',
      body: `In this Lease, "Landlord" includes the owner of the Premises and ${p.landlord} as the owner's managing agent. "Tenant" means each person who signs this Lease as a tenant. "Occupant" means a person named in this Lease who lives in the Premises but does not sign it. "Community" means the buildings, grounds, parking areas, and amenities of which the Premises are a part. "Resident portal" means the website and mobile application Landlord provides for payments, notices, and repair requests.`,
    },
    {
      title: 'JOINT RESPONSIBILITY',
      body: `If more than one person signs this Lease as Tenant, each of them is responsible for paying the full rent and for performing every other obligation of Tenant under this Lease. A notice from Landlord to one Tenant is notice to all Tenants, and a notice from one Tenant to Landlord is notice from all Tenants, except that a notice ending the tenancy of one Tenant under Virginia Code § 55.1-1235 or § 55.1-1236 applies only as that section provides.`,
    },
    {
      title: 'TERM',
      body: `The term of this Lease begins on November 1, 2026 and ends on October 31, 2027. Unless either party gives written notice of termination at least sixty (60) days before the end of the term, this Lease will continue month to month on the same terms. A month-to-month tenancy may be ended by either party with written notice given at least thirty (30) days before the next rent due date. Landlord will give any notice of a rent increase for a renewal term, and any notice that Landlord will not renew, in writing and within the time required by Virginia Code § 55.1-1204.`,
    },
    {
      title: 'RENT',
      body: `Tenant shall pay monthly rent of ${p.rent}, in advance, on or before the first (1st) day of each month, without demand. Rent for any partial month will be prorated by the day. Rent is payable to ${p.landlord} at the management office, by mail to [LANDLORD_ADDRESS], or through the online resident portal. Landlord will apply each payment first to rent then due and then to other charges, and will give Tenant a written receipt on request.`,
    },
    {
      title: 'PAYMENT METHODS',
      body: `Landlord accepts personal checks, cashier's checks, and money orders at no charge. Tenant may also pay through the resident portal by electronic bank transfer at no charge. A payment made by credit or debit card through the portal carries the card processor's fee, which is no more than the actual cost charged by the processor and is shown before Tenant confirms the payment. Tenant is never required to pay by a method that carries a fee.`,
    },
    {
      title: 'RESIDENT PORTAL',
      body: `Landlord provides the resident portal at no charge. Through it Tenant may pay rent, submit and track repair requests, read notices from Landlord, and download a copy of this Lease. Using the portal is optional: Tenant may instead pay at the office or by mail, make repair requests in writing, and receive notices on paper.`,
    },
    { title: 'LATE CHARGES', body: PLANTS.lateFee },
    {
      title: 'RETURNED PAYMENTS',
      body: `A charge of $35.00 will apply to any check or electronic payment returned by the bank for insufficient funds, together with any late charge that applies under this Lease. After two returned payments in any twelve-month period, Landlord may require Tenant to pay by cashier's check or money order for the rest of the term, after written notice to Tenant.`,
    },
    {
      title: 'RENT DURING THE TERM',
      body: `The monthly rent stated in this Lease will not change during the term. Landlord will not add any new fee or charge during the term unless both parties agree to it in writing. Any change in rent for a renewal term will be made only by written notice as stated in the Term section of this Lease.`,
    },
    {
      title: 'SECURITY DEPOSIT',
      body: PLANTS.deposit,
    },
    {
      title: 'USE OF THE DEPOSIT',
      body: `The security deposit secures Tenant's performance of every obligation under this Lease. Landlord will hold the deposit as Virginia law requires and will not commingle it with Landlord's operating funds. The security deposit may not be used by Tenant as the last month's rent. No damage insurance premium or renter's insurance premium is collected by Landlord before the start of the tenancy.`,
    },
    {
      title: 'RETURN OF DEPOSIT',
      body: `Within forty-five (45) days after the termination of the tenancy or the date Tenant vacates the Premises, whichever is later, Landlord will send Tenant, at the forwarding address Tenant provides in writing, the balance of the security deposit together with a written, itemized list of any deductions. Deductions may be made only for unpaid rent and other charges owed under this Lease and for damage to the Premises beyond reasonable wear and tear. Landlord will not deduct for normal wear and tear, such as faded paint, light scuffs, or carpet worn by ordinary use.`,
    },
    {
      title: 'USE AND OCCUPANCY',
      body: `The Premises shall be used only as a private residence for Tenant and the following occupants: [OCCUPANT_NAMES]. No other person may live in the Premises for more than fourteen (14) days in any six-month period without Landlord's written consent, which Landlord will not unreasonably withhold. Tenant shall not operate a business from the Premises that brings customers or deliveries of inventory to the community.`,
    },
    {
      title: 'GUESTS',
      body: `Tenant may have guests at the Premises. Tenant is responsible for the conduct of guests while they are in the community and shall make sure guests follow this Lease and the community rules. A guest may use the fitness room and other common areas only when accompanied by Tenant or an occupant.`,
    },
    {
      title: 'UTILITIES',
      body: `Tenant shall place the electric and gas accounts in Tenant's name before the start of the term and pay those charges directly to the provider. ${alt ? 'Landlord pays for water, sewer, and trash collection, and does not bill Tenant for them.' : 'Landlord pays for water, sewer, and trash collection.'} Tenant shall keep the heat on at a temperature of at least 55 degrees during cold weather to prevent frozen pipes. Landlord will not interrupt any utility or essential service to the Premises except for repairs or an emergency, and then only for as long as the work requires.`,
    },
    {
      title: 'APPLIANCES',
      body: `The appliances listed in the Premises section belong to Landlord and remain in the Premises at the end of the tenancy. Tenant shall use them only for their ordinary purposes and follow the manufacturer's instructions provided in the Premises. Tenant shall not install a second refrigerator, freezer, window air-conditioning unit, or portable dishwasher without Landlord's written consent, which Landlord will not unreasonably withhold. Tenant shall keep the dryer lint screen clean after each use.`,
    },
    {
      title: 'LAUNDRY ROOM',
      body: `The shared laundry room on the ground floor is open from 6:00 a.m. to 11:00 p.m. every day. The machines are operated by a card system, and the price of each cycle is posted in the room. Tenant shall remove laundry promptly when a cycle ends and shall not leave clothing or detergent in the room. Problems with a machine should be reported to the number posted on the machine.`,
    },
    {
      title: 'MOVE-IN INSPECTION',
      body: `Within five (5) days after Tenant moves in, Landlord will give Tenant a written report of any visible damage to the Premises. The report will be deemed correct unless Tenant objects to it in writing within five (5) days after receiving it. Tenant may add photographs or a written list of any damage Tenant finds, and Landlord will keep them with the report.`,
    },
    {
      title: 'TENANT CARE OF THE PREMISES',
      body: `Tenant shall keep the Premises clean, safe, and sanitary; dispose of trash in the containers provided; use the plumbing, electrical, heating, and other facilities and appliances in a reasonable manner; and not deliberately or carelessly damage the Premises or allow anyone else to do so. Tenant shall promptly notify Landlord in writing, or through the resident portal, of any condition that needs repair, including any moisture or visible mold.`,
    },
    { title: 'MAINTENANCE AND REPAIRS', body: PLANTS.hvac },
    {
      title: 'REPAIR REQUESTS',
      body: `Landlord will make repairs within a reasonable time after Tenant's request, and will treat a request about heat in winter, water, or a hazard to health or safety as an emergency. There is no fee for a repair request or for any repair or maintenance of the Premises, except that Tenant shall pay the reasonable cost of repairing damage caused by Tenant, an occupant, or a guest in violation of this Lease or Virginia law.`,
    },
    {
      title: 'SMOKE AND CARBON MONOXIDE ALARMS',
      body: `Landlord has installed working smoke alarms and a carbon monoxide alarm in the Premises. Tenant shall test the alarms monthly, replace their batteries during the tenancy when needed, and notify Landlord in writing of any alarm that does not work. Landlord will repair or replace an alarm within five (5) days after Tenant's written notice.`,
    },
    {
      title: 'ENTRY BY LANDLORD',
      body: `Tenant shall not unreasonably refuse to let Landlord enter the Premises to inspect, make necessary or agreed repairs, supply agreed services, or show the Premises to prospective tenants, buyers, or contractors. Except in an emergency, Landlord will enter only at reasonable times and only after notice to Tenant, and will not use the right of access to harass Tenant. In an emergency, Landlord may enter at any time and will tell Tenant afterward.`,
    },
    { title: 'ROUTINE MAINTENANCE', body: PLANTS.entry },
    {
      title: 'ALTERATIONS',
      body: `Tenant shall not paint, wallpaper, install fixtures, change locks, or make any other alteration to the Premises without Landlord's prior written consent. Tenant may hang pictures with small nails, and may use removable adhesive hooks. Any approved alteration becomes the property of Landlord unless the parties agree otherwise in writing.`,
    },
    {
      title: 'KEYS AND LOCKS',
      body: `Landlord will give Tenant two (2) keys to the Premises, one mailbox key, and one access card for the building. Landlord rekeyed the locks of the Premises after the previous tenant moved out. If Tenant is locked out outside office hours, Tenant may call the after-hours number listed on the resident portal.`,
    },
    {
      title: 'PACKAGES AND DELIVERIES',
      body: `Packages for Tenant may be delivered to the parcel lockers in the mail room. Tenant will receive a code by text message or email when a package arrives and shall remove it within five (5) days. Landlord does not accept packages on Tenant's behalf at the management office, and large furniture deliveries must be scheduled with the office so that the elevator can be reserved.`,
    },
    {
      title: 'AMENITIES',
      body: `Tenant, occupants, and accompanied guests may use the fitness room, the courtyard, the grilling area, and the business center during the hours posted at each amenity. The swimming pool is open from Memorial Day weekend through Labor Day, from 9:00 a.m. to 9:00 p.m., and no lifeguard is on duty. Children under fourteen (14) must be accompanied by an adult at the pool. Glass containers are not permitted in the pool area. Landlord may close an amenity for repairs, cleaning, or weather, and will post notice of any planned closing.`,
    },
    {
      title: 'STORAGE',
      body: `The storage closet assigned to the Premises may be used only to store Tenant's personal property. Tenant shall not store gasoline, propane, paint thinner, or other flammable or hazardous materials in the storage closet or anywhere in the Premises. Tenant shall provide Landlord with access to the storage closet on the same terms as access to the Premises.`,
    },
    {
      title: 'BICYCLES',
      body: `Bicycles may be stored inside the Premises, on the bicycle racks next to each building, or in the bicycle room. Bicycles may not be stored in hallways, stairwells, or on balconies where they block a path, and may not be locked to railings, trees, or light poles.`,
    },
    {
      title: 'TELEPHONE, CABLE, AND INTERNET',
      body: `The Premises are wired for telephone, cable television, and internet service. Tenant may choose any provider that serves the community and shall arrange and pay for that service directly. Tenant shall not run new cable through exterior walls or windows without Landlord's written consent.`,
    },
    {
      title: 'HEAVY ITEMS',
      body: `Waterbeds, aquariums larger than fifty (50) gallons, pianos, and other unusually heavy items may be kept in the Premises only with Landlord's written consent, which Landlord will not unreasonably withhold, so that the floor load can be checked.`,
    },
    {
      title: 'PETS',
      body: `No animals of any kind are permitted on the Premises without a signed Pet Addendum, except assistance animals as required by law. Tenant is responsible for any damage caused by an animal on the Premises and shall clean up after any animal in the common areas.`,
    },
    {
      title: 'SMOKING',
      body: 'Smoking of any substance, including the use of electronic cigarettes and vaporizers, is not permitted inside the Premises, on any balcony or patio, or within twenty-five (25) feet of any building entrance.',
    },
    {
      title: 'PARKING',
      body: `Tenant is assigned one (1) parking space, number ${alt ? '52' : '14'}. Additional vehicles may park in unassigned spaces when they are available. Vehicles that are inoperable or unregistered may be towed at the owner's expense after forty-eight (48) hours' notice posted on the vehicle. Boats, trailers, and recreational vehicles may not be parked in the community.`,
    },
    {
      title: 'NOISE AND CONDUCT',
      body: `Tenant, occupants, and guests shall not disturb other residents and shall comply with all laws in the community. Quiet hours are from 10:00 p.m. to 7:00 a.m. Musical instruments, televisions, and audio equipment shall be played at a volume that cannot be heard in another unit.`,
    },
    {
      title: 'COMMUNITY RULES',
      body: `Tenant shall follow the community rules attached to this Lease. Landlord may adopt a new rule or change a rule during the term only after reasonable written notice to Tenant. A rule must be reasonable and apply to all residents in a fair way. A new or changed rule that substantially modifies Tenant's bargain under this Lease does not apply to Tenant unless Tenant agrees to it in writing.`,
    },
    {
      title: 'TRASH AND RECYCLING',
      body: `Tenant shall place household trash in sealed bags in the dumpsters at the end of the parking lot and recyclables in the marked bins. Bulk items such as furniture and mattresses may not be left beside the dumpsters; Tenant may schedule a bulk pickup through the City of ${p.city}.`,
    },
    {
      title: 'PEST CONTROL',
      body: `Landlord provides pest control service for the community at no charge to Tenant, with treatment of the Premises on request. Tenant shall keep food in closed containers, remove trash regularly, and notify Landlord promptly of any sign of insects, rodents, or bed bugs. Tenant shall prepare the Premises for treatment as Landlord's pest control provider reasonably instructs.`,
    },
    {
      title: 'MOLD AND MOISTURE',
      body: `Landlord has inspected the Premises and found no visible evidence of mold. Tenant shall use the bathroom exhaust fans during and after showers, keep the Premises reasonably ventilated, and promptly report any water leak, condensation problem, or visible mold. Landlord will address any mold condition as required by Virginia law.`,
    },
    {
      title: 'LEAD-BASED PAINT',
      body: `The building in which the Premises are located was built in ${alt ? '2004' : '1998'}. No federal lead-based paint disclosure is required for housing built after 1977.`,
    },
    {
      title: 'SATELLITE DISHES AND ANTENNAS',
      body: `Tenant may install a satellite dish or antenna one meter or less in diameter only on a balcony or patio that is part of the Premises and under Tenant's exclusive use, as federal law allows. The dish or antenna may not be attached to the exterior walls, the roof, or a railing by drilling, and Tenant shall remove it and repair any damage at the end of the tenancy.`,
    },
    {
      title: 'FIRE SAFETY',
      body: `Tenant shall not block any exit, stairwell, or hallway, and shall not disable a smoke alarm, sprinkler head, or fire extinguisher. Candles and space heaters must be attended at all times. Landlord will inspect the fire extinguishers and sprinkler systems as the fire code requires, after notice to Tenant as stated in the Entry by Landlord section.`,
    },
    {
      title: 'WINTER WEATHER',
      body: `Landlord will clear snow and ice from the parking lots, sidewalks, and building entrances as soon as is reasonable after a storm ends. Tenant shall clear snow from Tenant's own vehicle and from any balcony or patio that is part of the Premises. During freezing weather, Tenant shall keep the cabinet doors under sinks on exterior walls open and shall not turn off the heat.`,
    },
    {
      title: 'EXTERIOR LIGHTING',
      body: `Landlord maintains lighting in the parking lots, walkways, and building entrances. Tenant should report a light that is out to the management office or through the resident portal, and Landlord will repair it within a reasonable time.`,
    },
    {
      title: 'HOLIDAY DECORATIONS',
      body: `Tenant may display holiday decorations on the door of the Premises and inside the windows. Decorations on a balcony or patio must be removed within thirty (30) days after the holiday. Live cut trees must be kept watered and removed by January 15.`,
    },
    {
      title: 'TRANSFER WITHIN THE COMMUNITY',
      body: `Tenant may ask to move to another unit in the community during the term. If a unit is available and Tenant is current on rent, Landlord and Tenant may sign a new lease for that unit, and Landlord will transfer the security deposit to the new lease after the move-out inspection of the Premises.`,
    },
    {
      title: 'WINDOW COVERINGS AND BALCONIES',
      body: `Tenant may install curtains or blinds inside the windows. Only outdoor furniture and plants in containers may be kept on a balcony or patio. Grills with an open flame may not be used on a balcony or patio, or within fifteen (15) feet of a building.`,
    },
    {
      title: "RENTER'S INSURANCE",
      body: `Tenant is encouraged to obtain renter's insurance covering Tenant's personal property and liability. Landlord's insurance does not cover Tenant's belongings. Renter's insurance is not a condition of this Lease.`,
    },
    { title: 'LIABILITY', body: PLANTS.exculpation },
    {
      title: 'FIRE OR CASUALTY',
      body: `If the Premises are damaged by fire or other casualty so that Tenant's enjoyment of the Premises is substantially impaired, or repairs require Tenant to vacate, either party may terminate this Lease as provided in Virginia Code § 55.1-1233. Rent will be prorated to the date of the casualty, and Landlord will return the security deposit and any prepaid rent as that section requires.`,
    },
    {
      title: 'ASSIGNMENT AND SUBLETTING',
      body: `Tenant shall not assign this Lease or sublet any part of the Premises without Landlord's prior written consent, which Landlord will not unreasonably withhold. Short-term rentals of the Premises through any online service are not permitted.`,
    },
    {
      title: 'MILITARY PERSONNEL',
      body: `A Tenant who is a member of the armed forces of the United States or the Virginia National Guard may terminate this Lease as provided in Virginia Code § 55.1-1235 and the Servicemembers Civil Relief Act by giving written notice with a copy of the official orders. Landlord will not charge any fee or liquidated damages for a termination under that section.`,
    },
    {
      title: 'EARLY TERMINATION BY VICTIMS OF ABUSE',
      body: `A Tenant who is a victim of family abuse, sexual abuse, stalking, or trafficking may terminate this Lease as provided in Virginia Code § 55.1-1236, by giving written notice and the documents that section describes. Landlord will not charge any fee or liquidated damages for a termination under that section.`,
    },
    {
      title: 'DEFAULT',
      body: `If Tenant fails to pay rent when due or materially breaches this Lease, Landlord may give Tenant the written notice that Virginia law requires and, if Tenant does not cure the breach within the time stated in that notice, may terminate this Lease and seek possession through the courts. If this Lease ends because of Tenant's breach, Landlord will make reasonable efforts to rent the Premises to a new tenant, and Tenant remains responsible for rent only until the end of the term or the date a new tenant begins paying rent, whichever comes first.`,
    },
    {
      title: 'POSSESSION',
      body: `Landlord will recover possession of the Premises only as Virginia law allows. Landlord will not change the locks, remove doors or Tenant's belongings, or cut off any utility to make Tenant leave.`,
    },
    {
      title: 'ABANDONMENT',
      body: `If Tenant is absent from the Premises for seven (7) days or more while rent is due and unpaid, Landlord may send written notice as required by Virginia law, and if Tenant does not respond within the time stated in that notice, the Premises may be treated as abandoned.`,
    },
    {
      title: 'SALE OF THE PROPERTY',
      body: `If the owner sells the community or the Premises during the term, this Lease will continue in effect, and the new owner will take over the duties of Landlord under this Lease, including the duty to hold and return the security deposit. Landlord will give Tenant written notice of the name and address of the new owner or manager.`,
    },
    {
      title: 'CONDEMNATION',
      body: `If all or part of the Premises is taken by a public authority through eminent domain so that the Premises can no longer be used as a residence, this Lease will end on the date of the taking, and rent will be prorated to that date. Landlord will return the security deposit and any prepaid rent as Virginia law requires.`,
    },
    {
      title: 'FAIR HOUSING AND ACCOMMODATIONS',
      body: `Landlord does not discriminate on the basis of race, color, religion, national origin, sex, elderliness, familial status, disability, source of funds, sexual orientation, gender identity, or military status. A Tenant with a disability may ask for a reasonable accommodation in rules, policies, or services, or for permission to make a reasonable modification of the Premises. Requests may be made orally or in writing to the management office.`,
    },
    {
      title: 'PRIVACY OF TENANT INFORMATION',
      body: `Landlord will keep Tenant's personal information, including Tenant's Social Security number and payment information, confidential, and will share it only with the owner, Landlord's service providers who need it to manage the Premises, or as required by law or with Tenant's written consent.`,
    },
    { title: alt ? 'GOVERNING LAW' : 'TENANT RIGHTS UNDER VIRGINIA LAW', body: PLANTS.waiver },
    { title: alt ? 'CLAIMS FOR MONEY' : 'CONFESSION OF JUDGMENT', body: PLANTS.confession },
    { title: 'ATTORNEY FEES', body: PLANTS.attorneyFees },
    {
      title: 'MOVE-OUT',
      body: `Tenant shall return all keys, remotes, and access cards on or before the last day of the tenancy and leave the Premises clean. Tenant has the right to be present at Landlord's inspection of the Premises for determining deductions from the security deposit. If Tenant requests in writing to be present, Landlord will notify Tenant of the date and time of the inspection, which will be made within seventy-two (72) hours after Tenant delivers possession.`,
    },
    {
      title: 'FORWARDING ADDRESS',
      body: `Before the end of the tenancy, Tenant shall give Landlord a forwarding address in writing so that Landlord can send the itemized list of deductions and any balance of the security deposit. If Tenant gives no forwarding address, Landlord will send them to the last known address of Tenant, which may be the Premises.`,
    },
    {
      title: 'MOVE-OUT CLEANING',
      body: `At the end of the tenancy Tenant shall remove all personal property and trash, clean the kitchen appliances, the cabinets, the bathrooms, and the floors, and replace any light bulbs that are burned out. A cleaning checklist is available at the management office. Landlord may deduct the reasonable cost of cleaning only when the Premises are left dirtier than they were at the start of the tenancy, apart from reasonable wear and tear.`,
    },
    {
      title: 'HOLDING OVER',
      body: `If Tenant remains in possession after the end of the term without Landlord's written consent, Tenant shall pay rent for the holdover period at the monthly rate stated in this Lease, prorated by the day.`,
    },
    {
      title: 'NOTICES',
      body: `Notices to Landlord shall be delivered in writing to ${p.landlord}, [LANDLORD_ADDRESS], or by email to the address on the resident portal. Notices to Tenant may be delivered to the Premises or by email to [TENANT_EMAIL]. A notice sent by email is given on the day it is sent.`,
    },
    {
      title: 'EMERGENCY CONTACT',
      body: `Tenant may give Landlord the name and telephone number of a person to contact in an emergency. Landlord will use it only in an emergency affecting Tenant or the Premises.`,
    },
    {
      title: 'STATEMENT OF TENANT RIGHTS',
      body: `Tenant acknowledges receiving the Virginia Statement of Tenant Rights and Responsibilities prepared by the Department of Housing and Community Development, and both parties have signed the acknowledgment form attached to this Lease.`,
    },
    {
      title: 'ENTIRE AGREEMENT',
      body: `This Lease, its addenda, the community rules, and the Move-In Inspection Report are the entire agreement between the parties. Any change to this Lease must be in writing and signed by both parties.`,
    },
    {
      title: 'ADDENDA',
      body: `The following documents are attached to this Lease and are part of it: the Statement of Tenant Rights and Responsibilities acknowledgment form, the community rules (Addendum A), the Pet Addendum if Tenant has a pet, and the Move-In Inspection Report once it is delivered.`,
    },
    {
      title: 'ELECTRONIC SIGNATURES',
      body: `This Lease and any addendum may be signed electronically and in counterparts. An electronic signature has the same effect as a handwritten signature, and Landlord will give Tenant a complete signed copy.`,
    },
    {
      title: 'SEVERABILITY',
      body: 'If any provision of this Lease is held invalid, the remaining provisions remain in effect.',
    },
  ];
}

// Addendum A: the community rules the Community Rules section refers to.
function addendum(p: Parties): string[] {
  return [
    'ADDENDUM A: COMMUNITY RULES',
    `These rules apply to every resident of the ${p.short} community and their guests. They may be changed only as stated in the Community Rules section of the Lease.`,
    'A1. Common areas. Hallways, stairwells, and entrances must be kept clear. Doormats are allowed; shoes, strollers, and furniture may not be left in hallways.',
    'A2. Pool. Residents must carry their access card at the pool. No more than four (4) guests per unit may use the pool at one time. Swim diapers are required for children who are not toilet trained.',
    'A3. Fitness room. Equipment must be wiped down after use. Residents under sixteen (16) must be accompanied by an adult. The fitness room may not be used for personal training businesses.',
    'A4. Grilling area. Grills must be cleaned after use and turned off when finished. The grilling area closes at 10:00 p.m.',
    'A5. Pets in common areas. Pets must be on a leash in all common areas and may not be left tied outside. Pet waste must be picked up and placed in the pet waste stations.',
    'A6. Vehicles. Vehicles may not be washed, repaired, or have their oil changed in the parking lots. The speed limit in the community is ten (10) miles per hour.',
    'A7. Moving. Moves in and out must be made between 8:00 a.m. and 8:00 p.m. Residents must reserve the elevator with the office at least two (2) days before a move.',
    'A8. Balconies and patios. Laundry may not be hung over a railing. Rugs and mops may not be shaken over a railing.',
    'A9. Solicitation. Door-to-door sales and the posting of flyers in common areas are not permitted, except on the community bulletin board in the mail room.',
    'A10. Complaints. A resident with a complaint about another resident or about these rules may contact the management office in writing or through the resident portal.',
  ];
}

// The page count is nominal: a standard lease page holds about 3,000 characters.
export function leaseText(v: Variant): { text: string; expected: { ruleId: string; heading: string; severity: Severity }[] } {
  const p = PARTIES[v];
  const expected: { ruleId: string; heading: string; severity: Severity }[] = [];
  const body = sections(v).map((s, i) => {
    const heading = `${i + 1}. ${s.title}.`;
    if (typeof s.body === 'string') return `${heading} ${s.body}`;
    if (v === 'planted') expected.push({ ruleId: s.body.ruleId, heading, severity: s.body.severity });
    return `${heading} ${s.body.text[v]}`;
  });
  const text = [
    'RESIDENTIAL LEASE AGREEMENT',
    'Commonwealth of Virginia',
    `This Residential Lease Agreement ("Lease") is made on ${p.date}, between ${p.landlord}, as agent for the owner ("Landlord"), and [TENANT_NAME] ("Tenant"), for the dwelling unit described below. Landlord manages more than four rental dwelling units in Virginia.`,
    ...body,
    `LANDLORD: ${p.landlord}, by [AGENT_NAME], Property Manager`,
    'TENANT: [TENANT_NAME]',
    `Date: ${p.date}`,
    ...addendum(p),
  ].join('\n\n');
  return { text: `${text}\n`, expected };
}

const OUT = new URL('../eval/datasets/lease-synthetic/', import.meta.url);
const MANIFEST = new URL('../eval/datasets/lease-synthetic.jsonl', import.meta.url);
const VARIANTS: Variant[] = ['planted', 'clean', 'clean-alt'];

function outputs(): Map<URL, string> {
  const files = new Map<URL, string>();
  const lines: string[] = [];
  for (const v of VARIANTS) {
    const { text, expected } = leaseText(v);
    files.set(new URL(`${v}.txt`, OUT), text);
    lines.push(JSON.stringify({ id: v, file: `lease-synthetic/${v}.txt`, locale: 'en', expected }));
  }
  files.set(MANIFEST, `${lines.join('\n')}\n`);
  return files;
}

if (import.meta.main) {
  const check = process.argv.includes('--check');
  let stale = 0;
  mkdirSync(OUT, { recursive: true });
  for (const [url, content] of outputs()) {
    let current: string | null = null;
    try {
      current = readFileSync(url, 'utf8');
    } catch {}
    if (current === content) continue;
    stale++;
    if (check) console.error(`out of date: ${url.pathname}`);
    else writeFileSync(url, content);
  }
  for (const v of VARIANTS) console.log(`${v}: ${leaseText(v).text.length} characters`);
  if (check && stale > 0) {
    console.error('run: node scripts/make-synthetic-lease.ts');
    process.exit(1);
  }
}
