-module(sim_clock).
-export([run/4, run_stream/5]).
-include("planet.hrl").

%% Wait for exactly N messages matching MatchFun, return their unwrapped values.
%% This is the "barrier" — nobody proceeds to the next phase until every
%% planet process has reported in for this one.
collect(0, _MatchFun, Acc) -> Acc;
collect(N, MatchFun, Acc) ->
    receive
        Msg ->
            case MatchFun(Msg) of
                {ok, Val} -> collect(N - 1, MatchFun, [Val | Acc]);
                ignore    -> collect(N, MatchFun, Acc)
            end
    after 5000 ->
        exit({timeout_waiting_for_messages, N})
    end.

%% One-time initial acceleration seed (see planet.erl's seed_accel).
seed(Pids) ->
    Self = self(),
    N = length(Pids),
    [Pid ! {snapshot, Self} || Pid <- Pids],
    Snaps = collect(N, fun
        ({snapshot, P, Name, Mass, X, Y}) -> {ok, {P, Name, Mass, X, Y}};
        (_) -> ignore
    end, []),
    lists:foreach(fun({Pid, _Name, _Mass, _X, _Y}) ->
        Others = [{M, X, Y} || {P, _, M, X, Y} <- Snaps, P =/= Pid],
        Pid ! {seed_accel, Others, Self}
    end, Snaps),
    collect(N, fun({seeded, _}) -> {ok, done}; (_) -> ignore end, []),
    ok.

%% One physics tick, three synchronized phases.
tick(Pids, Dt) ->
    Self = self(),
    N = length(Pids),

    % Phase 1 — every planet moves itself using OLD acceleration. Fully
    % concurrent: no planet needs to hear from any other planet here.
    [Pid ! {advance_pos, Dt, Self} || Pid <- Pids],
    collect(N, fun({posdone, _}) -> {ok, done}; (_) -> ignore end, []),

    % Phase 2 — gather everyone's NEW position into one consistent snapshot.
    [Pid ! {snapshot, Self} || Pid <- Pids],
    Snaps = collect(N, fun
        ({snapshot, P, Name, Mass, X, Y}) -> {ok, {P, Name, Mass, X, Y}};
        (_) -> ignore
    end, []),

    % Phase 3 — each planet computes gravity from that snapshot and
    % finishes its velocity update. Also fully concurrent across planets.
    lists:foreach(fun({Pid, _Name, _Mass, _X, _Y}) ->
        Others = [{M, X, Y} || {P, _, M, X, Y} <- Snaps, P =/= Pid],
        Pid ! {finish_step, Others, Dt, Self}
    end, Snaps),
    collect(N, fun({stepdone, _}) -> {ok, done}; (_) -> ignore end, []),
    ok.

run(Pids, Dt, Ticks, LogEvery) ->
    seed(Pids),
    lists:foreach(fun(T) ->
        tick(Pids, Dt),
        case T rem LogEvery of
            0 -> log_state(Pids, T, Dt);
            _ -> ok
        end
    end, lists:seq(1, Ticks)).

run_stream(Pids, Dt, Ticks, FrameEvery, FrameDelayMs) ->
    seed(Pids),
    lists:foreach(fun(T) ->
        tick(Pids, Dt),
        case T rem FrameEvery of
            0 ->
                emit_frame(Pids, T, Dt),
                timer:sleep(FrameDelayMs);
            _ -> ok
        end
    end, lists:seq(1, Ticks)),
    io:put_chars("{\"type\":\"complete\"}\n").

log_state(Pids, T, Dt) ->
    Fulls = full_states(Pids),
    Sorted = lists:sort(fun(A, B) -> A#planet.name =< B#planet.name end, Fulls),
    io:format("~n-- tick ~p (day ~.1f) --~n", [T, T * Dt]),
    lists:foreach(fun(#planet{name = Name, x = X, y = Y}) ->
        R = math:sqrt(X*X + Y*Y),
        io:format("  ~-10s x=~9.4f  y=~9.4f  r=~8.4f AU~n", [Name, X, Y, R])
    end, Sorted).

full_states(Pids) ->
    Self = self(),
    N = length(Pids),
    [Pid ! {get_full, Self} || Pid <- Pids],
    collect(N, fun({full, _, S}) -> {ok, S}; (_) -> ignore end, []).

emit_frame(Pids, T, Dt) ->
    Fulls0 = full_states(Pids),
    Fulls = lists:sort(fun(A, B) -> A#planet.name =< B#planet.name end, Fulls0),
    Bodies = [body_json(Body) || Body <- Fulls],
    io:put_chars([
        "{\"type\":\"frame\",\"tick\":", integer_to_list(T),
        ",\"simulatedDays\":", number_json(T * Dt),
        ",\"bodies\":[", join_json(Bodies), "]}\n"
    ]).

body_json(#planet{name = Name, mass = Mass, diameter = Diameter, color = Color,
                  x = X, y = Y, vx = Vx, vy = Vy}) ->
    [
        "{\"name\":", string_json(Name),
        ",\"mass\":", number_json(Mass),
        ",\"diameter\":", integer_to_list(Diameter),
        ",\"color\":", string_json(Color),
        ",\"x\":", number_json(X),
        ",\"y\":", number_json(Y),
        ",\"vx\":", number_json(Vx),
        ",\"vy\":", number_json(Vy), "}"
    ].

join_json([]) -> [];
join_json([First | Rest]) -> lists:foldl(fun(Item, Acc) -> [Acc, $,, Item] end, First, Rest).

number_json(Value) -> io_lib:format("~.12g", [Value]).

string_json(String) -> [$", escape_json(String), $"] .

escape_json([]) -> [];
escape_json([$" | Rest]) -> ["\\\"" | escape_json(Rest)];
escape_json([$\\ | Rest]) -> ["\\\\" | escape_json(Rest)];
escape_json([Character | Rest]) when Character < 32 ->
    [io_lib:format("\\u~4.16.0B", [Character]) | escape_json(Rest)];
escape_json([Character | Rest]) -> [Character | escape_json(Rest)].