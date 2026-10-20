// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {FeeSplitter} from "../src/FeeSplitter.sol";
import {SequencerToken} from "../src/SequencerToken.sol";

/// @dev Re-enters split() from its own receive().
contract ReentrantTeam {
    FeeSplitter public splitter;
    uint256 public calls;

    function set(FeeSplitter s) external {
        splitter = s;
    }

    receive() external payable {
        if (calls++ == 0) {
            try splitter.split() {} catch {}
        }
    }
}

contract RejectingTeam {
    receive() external payable {
        revert("no");
    }
}

/// @dev Pays like the factory's push: a plain transfer with a 2300-gas stipend.
contract StipendPayer {
    function pay(address payable to) external payable {
        to.transfer(msg.value);
    }
}

contract FeeSplitterTest is Test {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address team = makeAddr("team");
    address treasury = makeAddr("treasury");
    SequencerToken idm;
    FeeSplitter splitter;

    event Split(uint256 toTreasury, uint256 toTeam, uint256 burned);

    function setUp() public {
        idm = new SequencerToken();
        splitter = new FeeSplitter(team, treasury, address(idm));
    }

    function test_constructor_rejectsZeroAddresses() public {
        vm.expectRevert(FeeSplitter.ZeroAddress.selector);
        new FeeSplitter(address(0), treasury, address(idm));
        vm.expectRevert(FeeSplitter.ZeroAddress.selector);
        new FeeSplitter(team, address(0), address(idm));
        vm.expectRevert(FeeSplitter.ZeroAddress.selector);
        new FeeSplitter(team, treasury, address(0));
    }

    function test_receive_takesEthUnderStipend() public {
        new StipendPayer().pay{value: 1 ether}(payable(address(splitter)));
        assertEq(address(splitter).balance, 1 ether);
    }

    function test_split_halvesEthAndBurnsAllIdm() public {
        vm.deal(address(splitter), 1 ether + 1);
        idm.transfer(address(splitter), 5e18);
        vm.expectEmit(address(splitter));
        emit Split(0.5 ether, 0.5 ether + 1, 5e18);
        (uint256 toTreasury, uint256 toTeam, uint256 burned) = splitter.split();
        assertEq(toTreasury, 0.5 ether);
        assertEq(toTeam, 0.5 ether + 1);
        assertEq(burned, 5e18);
        assertEq(treasury.balance, 0.5 ether);
        assertEq(team.balance, 0.5 ether + 1);
        assertEq(idm.balanceOf(DEAD), 5e18);
        assertEq(idm.balanceOf(team), 0);
        assertEq(idm.balanceOf(address(splitter)), 0);
        assertEq(address(splitter).balance, 0);
    }

    function test_split_onlyIdm() public {
        idm.transfer(address(splitter), 7);
        splitter.split();
        assertEq(idm.balanceOf(DEAD), 7);
        assertEq(team.balance + treasury.balance, 0);
    }

    function test_split_onlyEth_oneWeiGoesToTeam() public {
        vm.deal(address(splitter), 1);
        splitter.split();
        assertEq(treasury.balance, 0);
        assertEq(team.balance, 1);
    }

    function test_split_nothingReverts() public {
        vm.expectRevert(FeeSplitter.NothingToSplit.selector);
        splitter.split();
    }

    function test_split_isPermissionless() public {
        vm.deal(address(splitter), 2 ether);
        vm.prank(makeAddr("anyone"));
        splitter.split();
        assertEq(treasury.balance, 1 ether);
        assertEq(team.balance, 1 ether);
    }

    function test_split_reentrantTeamCannotTakeTreasuryHalf() public {
        ReentrantTeam rt = new ReentrantTeam();
        FeeSplitter s = new FeeSplitter(address(rt), treasury, address(idm));
        rt.set(s);
        vm.deal(address(s), 2 ether);
        s.split();
        assertEq(treasury.balance, 1 ether);
        assertEq(address(rt).balance, 1 ether);
        assertEq(rt.calls(), 1);
    }

    function test_split_rejectingTeamReverts() public {
        FeeSplitter s = new FeeSplitter(address(new RejectingTeam()), treasury, address(idm));
        vm.deal(address(s), 2 ether);
        vm.expectRevert();
        s.split();
        assertEq(address(s).balance, 2 ether);
    }

    function testFuzz_split_conservesEth(uint96 eth, uint96 tokens) public {
        tokens = uint96(bound(tokens, 0, idm.totalSupply()));
        vm.assume(eth > 0 || tokens > 0);
        vm.deal(address(splitter), eth);
        idm.transfer(address(splitter), tokens);
        splitter.split();
        assertEq(treasury.balance + team.balance, eth);
        assertLe(team.balance - treasury.balance, 1);
        assertEq(idm.balanceOf(DEAD), tokens);
    }
}
