// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {SequencerToken} from "../src/SequencerToken.sol";

contract SequencerTokenTest is Test {
    SequencerToken token;

    function setUp() public {
        token = new SequencerToken();
    }

    function test_FactoryReceivesEntireFixedSupply() public view {
        assertEq(token.name(), "Intelligent Dance Market");
        assertEq(token.symbol(), "IDM");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1e27);
        assertEq(token.balanceOf(address(this)), 1e27);
    }

    function test_TransferAndFiniteAllowance() public {
        token.approve(address(7), 100);
        vm.prank(address(7));
        token.transferFrom(address(this), address(8), 60);
        assertEq(token.allowance(address(this), address(7)), 40);
        assertEq(token.balanceOf(address(8)), 60);
        assertEq(token.balanceOf(address(this)), 1e27 - 60);
    }

    function test_UnlimitedAllowancePreserved() public {
        token.approve(address(7), type(uint256).max);
        vm.prank(address(7));
        token.transferFrom(address(this), address(8), 60);
        assertEq(token.allowance(address(this), address(7)), type(uint256).max);
    }

    function test_SelfTransferAndZeroTransferPreserveSupply() public {
        token.transfer(address(this), 1e27);
        token.transfer(address(8), 0);
        assertEq(token.balanceOf(address(this)), 1e27);
        assertEq(token.totalSupply(), 1e27);
    }

    function test_InvalidTransfersRevert() public {
        vm.expectRevert(SequencerToken.ZeroAddress.selector);
        token.transfer(address(0), 1);
        vm.expectRevert(SequencerToken.InsufficientBalance.selector);
        token.transfer(address(8), 1e27 + 1);
        vm.prank(address(7));
        vm.expectRevert(SequencerToken.InsufficientAllowance.selector);
        token.transferFrom(address(this), address(8), 1);
    }

    function testFuzz_TransferConservesSupply(uint256 amount) public {
        amount = bound(amount, 0, 1e27);
        token.transfer(address(8), amount);
        assertEq(token.balanceOf(address(this)) + token.balanceOf(address(8)), token.totalSupply());
    }
}
