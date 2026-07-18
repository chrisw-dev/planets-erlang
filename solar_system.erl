-module(solar_system).
-export([start/0, start_stream/0]).
-include("planet.hrl").

%% {Name, Mass (Msun), Diameter (km), Color, SemiMajorAxis (AU, 0.0 for Sun),
%%  ParentName}
data() -> [
    {"Sun",     1.0,      1391000, "#e8a33d", 0.0, undefined},
    {"Mercury", 1.660e-7, 4879,    "#9a9a95", 0.387, "Sun"},
    {"Venus",   2.447e-6, 12104,   "#e0c27a", 0.723, "Sun"},
    {"Earth",   3.003e-6, 12742,   "#5ec8d8", 1.000, "Sun"},
    {"Moon",    1.0e-12,  3474,    "#c0c0c0", 0.00100, "Earth"},
    {"Mars",    3.213e-7, 6779,    "#c1553c", 1.524, "Sun"},
    {"Jupiter", 9.545e-4, 139820,  "#d9b38c", 5.203, "Sun"},
    {"Saturn",  2.858e-4, 116460,  "#e8d3a0", 9.537, "Sun"},
    {"Uranus",  4.365e-5, 50724,   "#9fd6e0", 19.191, "Sun"},
    {"Neptune", 5.150e-5, 49244,   "#5f7fe0", 30.069, "Sun"}
].

make_planets(Data) ->
    {Planets, _} = lists:foldl(
        fun(Spec, {Acc, ParentMap}) ->
            Planet = make_planet(Spec, ParentMap),
            {[Planet | Acc], ParentMap#{Planet#planet.name => Planet}}
        end,
        {[], #{}},
        Data
    ),
    lists:reverse(Planets).

make_planet({Name, Mass, Diameter, Color, A, Parent}, ParentMap) ->
    {X, Y, Vx, Vy} = case Parent of
        undefined ->
            {0.0, 0.0, 0.0, 0.0};
        _ ->
            ParentPlanet = maps:get(Parent, ParentMap, undefined),
            case ParentPlanet of
                undefined ->
                    erlang:error({unknown_parent, Parent, Name});
                #planet{x = Px, y = Py, vx = PVx, vy = PVy, mass = ParentMass} ->
                    V = math:sqrt(?G * (ParentMass + Mass) / A),
                    {Px + A, Py, PVx, PVy + V}
            end
    end,
    #planet{name = Name, mass = Mass, diameter = Diameter, color = Color,
            parent = Parent,
            x = X, y = Y, vx = Vx, vy = Vy}.

start() ->
    Planets = make_planets(data()),
    Pids = [planet:start(P) || P <- Planets],

    Dt       = 0.25,  % days per physics substep
    Ticks    = 2000,  % 500 days simulated
    LogEvery = 400,   % print a snapshot every 100 days

    sim_clock:run(Pids, Dt, Ticks, LogEvery),

    [Pid ! stop || Pid <- Pids],
    ok.

start_stream() ->
    Planets = make_planets(data()),
    Pids = [planet:start(P) || P <- Planets],

    Dt = 0.25,
    Ticks = 20000,
    LogEvery = 5,
    TimeBetweenTicks = 2,

    sim_clock:run_stream(Pids, Dt, Ticks, LogEvery, TimeBetweenTicks),
    [Pid ! stop || Pid <- Pids],
    ok.