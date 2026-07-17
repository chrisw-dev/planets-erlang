-record(planet, {
    name,
    mass,       % solar masses
    diameter,   % km, display only — not used in physics
    color,      % hex string, display only
    x, y,       % AU
    vx, vy,     % AU/day
    ax = 0.0,   % last known acceleration (AU/day^2) — the Verlet "memory"
    ay = 0.0
}).