-module(physics).
-export([acceleration/2]).
-include("planet.hrl").

%% acceleration({X,Y}, [{Mass2,X2,Y2}, ...]) -> {Ax, Ay}
%% Sum of pairwise gravitational pulls from every other body.
acceleration({X, Y}, Others) ->
    lists:foldl(
        fun({M2, X2, Y2}, {AxAcc, AyAcc}) ->
            Dx = X2 - X,
            Dy = Y2 - Y,
            R2 = Dx*Dx + Dy*Dy + 1.0e-9,   % soften to dodge div-by-zero on collision
            R  = math:sqrt(R2),
            F  = ?G / (R2 * R),            % G / r^3
            {AxAcc + F * M2 * Dx, AyAcc + F * M2 * Dy}
        end,
        {0.0, 0.0},
        Others
    ).