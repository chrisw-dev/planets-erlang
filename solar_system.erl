-module(solar_system).
-export([start/0]).
-include("planet.hrl").

-define(G, 0.00029591220819).

%% {Name, Mass (Msun), Diameter (km), Color, SemiMajorAxis (AU, 0.0 for Sun)}
data() -> [
    {"Sun",     1.0,      1391000, "#e8a33d", 0.0},
    {"Mercury", 1.660e-7, 4879,    "#9a9a95", 0.387},
    {"Venus",   2.447e-6, 12104,   "#e0c27a", 0.723},
    {"Earth",   3.003e-6, 12742,   "#5ec8d8", 1.000},
    {"Mars",    3.213e-7, 6779,    "#c1553c", 1.524},
    {"Jupiter", 9.545e-4, 139820,  "#d9b38c", 5.203},
    {"Saturn",  2.858e-4, 116460,  "#e8d3a0", 9.537},
    {"Uranus",  4.365e-5, 50724,   "#9fd6e0", 19.191},
    {"Neptune", 5.150e-5, 49244,   "#5f7fe0", 30.069}
].

make_planet({Name, Mass, Diameter, Color, A}) ->
    {X, Y, Vx, Vy} = case A of
        0.0 -> {0.0, 0.0, 0.0, 0.0};
        _   ->
            V = math:sqrt(?G / A),   % circular orbital speed at radius A
            {A, 0.0, 0.0, V}
    end,
    #planet{name = Name, mass = Mass, diameter = Diameter, color = Color,
             x = X, y = Y, vx = Vx, vy = Vy}.

start() ->
    Planets = [make_planet(D) || D <- data()],
    Pids = [planet:start(P) || P <- Planets],

    Dt       = 0.25,  % days per physics substep
    Ticks    = 2000,  % 500 days simulated
    LogEvery = 400,   % print a snapshot every 100 days

    sim_clock:run(Pids, Dt, Ticks, LogEvery),

    [Pid ! stop || Pid <- Pids],
    ok.