// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Minimal} from "v4-core/src/interfaces/external/IERC20Minimal.sol";

/// @title FeeSplitter
/// @notice Receives the launcher's 1% fee share (native ETH and IDM) in place of the treasury. split() sends half of
///         the ETH to the PulseTreasury and the other half to the team, and burns every IDM it holds to 0x…dEaD:
///         the team never receives IDM from fees.
///         Immutable: no owner, no admin, no upgrade; the shares and both recipients are fixed at deploy.
///
/// @dev Payouts. The LaunchFactory pushes the fee in both pool currencies: receive() is empty, so it takes ETH even
///      under a 2300-gas stipend, and IDM arrives by plain transfer. split() is permissionless; the keeper calls it
///      right after claimFees.
///
///      Order. The treasury is paid before the team, so a team contract that re-enters split() finds only what
///      arrived since, never the treasury's half. A team address that rejects ETH makes split() revert: the team
///      must be a wallet that accepts plain transfers.
contract FeeSplitter {
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    /// @notice Gets the ETH that is not the treasury's (half, plus the odd wei).
    address public immutable team;
    /// @notice The PulseTreasury: gets half of the ETH, rounded down.
    address public immutable treasury;
    /// @notice IDM, burned in full on every split().
    address public immutable idm;

    event Split(uint256 toTreasury, uint256 toTeam, uint256 burned);

    error ZeroAddress();
    error NothingToSplit();
    error SendFailed(address to);

    constructor(address team_, address treasury_, address idm_) {
        if (team_ == address(0) || treasury_ == address(0) || idm_ == address(0)) revert ZeroAddress();
        team = team_;
        treasury = treasury_;
        idm = idm_;
    }

    /// @notice Accepts ETH from anyone (fee payouts, donations). Empty body: safe under a 2300-gas stipend.
    receive() external payable {}

    /// @notice Pays out the ETH 50/50 (treasury first) and burns all IDM. Callable by anyone.
    function split() external returns (uint256 toTreasury, uint256 toTeam, uint256 burned) {
        burned = IERC20Minimal(idm).balanceOf(address(this));
        uint256 eth = address(this).balance;
        if (eth == 0 && burned == 0) revert NothingToSplit();
        if (burned > 0) require(IERC20Minimal(idm).transfer(DEAD, burned));
        toTreasury = eth / 2;
        toTeam = eth - toTreasury;
        _send(treasury, toTreasury);
        _send(team, toTeam);
        emit Split(toTreasury, toTeam, burned);
    }

    function _send(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert SendFailed(to);
    }
}
