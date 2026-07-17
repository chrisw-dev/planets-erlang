-module(planet).
-export([start/1, loop/1]).
-include("planet.hrl").

start(Init = #planet{}) ->
    spawn(?MODULE, loop, [Init]).

loop(State) ->
    receive
        %% Phase 0 (once, at boot): compute initial acceleration from a
        %% snapshot of everyone else, so the very first Verlet step isn't
        %% starting from a false ax=ay=0.0.
        {seed_accel, Others, From} ->
            #planet{x = X, y = Y} = State,
            {Ax, Ay} = physics:acceleration({X, Y}, Others),
            From ! {seeded, self()},
            loop(State#planet{ax = Ax, ay = Ay});

        %% Phase 1: advance position using ONLY my own stored velocity and
        %% last-known acceleration. Needs nobody else's data, so every
        %% planet process does this in parallel.
        {advance_pos, Dt, From} ->
            #planet{x = X, y = Y, vx = Vx, vy = Vy, ax = Ax, ay = Ay} = State,
            NX = X + Vx*Dt + 0.5*Ax*Dt*Dt,
            NY = Y + Vy*Dt + 0.5*Ay*Dt*Dt,
            From ! {posdone, self()},
            loop(State#planet{x = NX, y = NY});

        %% Used by the coordinator to gather a consistent snapshot of
        %% positions (mid-tick, after everyone has advanced).
        {snapshot, From} ->
            #planet{name = Name, mass = Mass, x = X, y = Y} = State,
            From ! {snapshot, self(), Name, Mass, X, Y},
            loop(State);

        %% Phase 3: now that every body's NEW position is known, compute
        %% acceleration there and finish the velocity update
        %% (v += 0.5*(a_old + a_new)*dt — the second half of Verlet).
        {finish_step, Others, Dt, From} ->
            #planet{x = X, y = Y, vx = Vx, vy = Vy, ax = Ax, ay = Ay} = State,
            {NAx, NAy} = physics:acceleration({X, Y}, Others),
            NVx = Vx + 0.5 * (Ax + NAx) * Dt,
            NVy = Vy + 0.5 * (Ay + NAy) * Dt,
            From ! {stepdone, self()},
            loop(State#planet{vx = NVx, vy = NVy, ax = NAx, ay = NAy});

        {get_full, From} ->
            From ! {full, self(), State},
            loop(State);

        stop ->
            ok
    end.