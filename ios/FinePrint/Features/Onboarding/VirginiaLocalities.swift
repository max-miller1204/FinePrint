import Foundation

/// A city or county, the only place detail FinePrint keeps (spec §6.3: never a street address).
nonisolated struct Locality: Hashable, Identifiable, Sendable {
    enum Kind: String, Sendable {
        /// Virginia's independent cities belong to no county.
        case city
        case county
    }

    var name: String
    var kind: Kind

    var id: String { "\(name.lowercased().replacing(" ", with: "-"))-\(kind.rawValue)" }

    /// What the tenant sees: "Richmond" (the city) or "Richmond County".
    var displayName: String {
        kind == .county ? "\(name) County" : name
    }

    /// Lowercased text a search is matched against.
    var searchText: String { displayName.lowercased() }
}

/// The 95 counties and 38 independent cities of Virginia, bundled so a Virginia renter picks from a
/// list instead of typing. A town such as Blacksburg is not listed: the tenant picks its county, or
/// types the town.
nonisolated enum VirginiaLocalities {
    static let all: [Locality] = (counties.map { Locality(name: $0, kind: .county) }
        + cities.map { Locality(name: $0, kind: .city) })
        .sorted { ($0.name, $0.kind.rawValue) < ($1.name, $1.kind.rawValue) }

    /// Every word of `query` must appear in the name.
    static func matching(_ query: String) -> [Locality] {
        let words = query.lowercased().split(separator: " ").map(String.init)
        guard !words.isEmpty else { return all }
        return all.filter { locality in words.allSatisfy { locality.searchText.contains($0) } }
    }

    static let defaultCity = Locality(name: "Richmond", kind: .city)

    static let counties = [
        "Accomack", "Albemarle", "Alleghany", "Amelia", "Amherst", "Appomattox", "Arlington", "Augusta",
        "Bath", "Bedford", "Bland", "Botetourt", "Brunswick", "Buchanan", "Buckingham", "Campbell",
        "Caroline", "Carroll", "Charles City", "Charlotte", "Chesterfield", "Clarke", "Craig", "Culpeper",
        "Cumberland", "Dickenson", "Dinwiddie", "Essex", "Fairfax", "Fauquier", "Floyd", "Fluvanna",
        "Franklin", "Frederick", "Giles", "Gloucester", "Goochland", "Grayson", "Greene", "Greensville",
        "Halifax", "Hanover", "Henrico", "Henry", "Highland", "Isle of Wight", "James City",
        "King and Queen", "King George", "King William", "Lancaster", "Lee", "Loudoun", "Louisa",
        "Lunenburg", "Madison", "Mathews", "Mecklenburg", "Middlesex", "Montgomery", "Nelson", "New Kent",
        "Northampton", "Northumberland", "Nottoway", "Orange", "Page", "Patrick", "Pittsylvania",
        "Powhatan", "Prince Edward", "Prince George", "Prince William", "Pulaski", "Rappahannock",
        "Richmond", "Roanoke", "Rockbridge", "Rockingham", "Russell", "Scott", "Shenandoah", "Smyth",
        "Southampton", "Spotsylvania", "Stafford", "Surry", "Sussex", "Tazewell", "Warren", "Washington",
        "Westmoreland", "Wise", "Wythe", "York",
    ]

    static let cities = [
        "Alexandria", "Bristol", "Buena Vista", "Charlottesville", "Chesapeake", "Colonial Heights",
        "Covington", "Danville", "Emporia", "Fairfax", "Falls Church", "Franklin", "Fredericksburg",
        "Galax", "Hampton", "Harrisonburg", "Hopewell", "Lexington", "Lynchburg", "Manassas",
        "Manassas Park", "Martinsville", "Newport News", "Norfolk", "Norton", "Petersburg", "Poquoson",
        "Portsmouth", "Radford", "Richmond", "Roanoke", "Salem", "Staunton", "Suffolk", "Virginia Beach",
        "Waynesboro", "Williamsburg", "Winchester",
    ]
}

/// US states for the "outside Virginia" path. Evidence tools work anywhere (spec §4.2).
nonisolated struct USState: Hashable, Identifiable, Sendable {
    var code: String
    var name: String
    var id: String { code }

    static let virginia = USState(code: "VA", name: "Virginia")

    static let all: [USState] = [
        ("AL", "Alabama"), ("AK", "Alaska"), ("AZ", "Arizona"), ("AR", "Arkansas"), ("CA", "California"),
        ("CO", "Colorado"), ("CT", "Connecticut"), ("DE", "Delaware"), ("DC", "District of Columbia"),
        ("FL", "Florida"), ("GA", "Georgia"), ("HI", "Hawaii"), ("ID", "Idaho"), ("IL", "Illinois"),
        ("IN", "Indiana"), ("IA", "Iowa"), ("KS", "Kansas"), ("KY", "Kentucky"), ("LA", "Louisiana"),
        ("ME", "Maine"), ("MD", "Maryland"), ("MA", "Massachusetts"), ("MI", "Michigan"),
        ("MN", "Minnesota"), ("MS", "Mississippi"), ("MO", "Missouri"), ("MT", "Montana"),
        ("NE", "Nebraska"), ("NV", "Nevada"), ("NH", "New Hampshire"), ("NJ", "New Jersey"),
        ("NM", "New Mexico"), ("NY", "New York"), ("NC", "North Carolina"), ("ND", "North Dakota"),
        ("OH", "Ohio"), ("OK", "Oklahoma"), ("OR", "Oregon"), ("PA", "Pennsylvania"),
        ("RI", "Rhode Island"), ("SC", "South Carolina"), ("SD", "South Dakota"), ("TN", "Tennessee"),
        ("TX", "Texas"), ("UT", "Utah"), ("VT", "Vermont"), ("VA", "Virginia"), ("WA", "Washington"),
        ("WV", "West Virginia"), ("WI", "Wisconsin"), ("WY", "Wyoming"),
    ].map { USState(code: $0.0, name: $0.1) }
}
