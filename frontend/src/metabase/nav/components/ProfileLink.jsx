import React, { Component } from "react";
import PropTypes from "prop-types";
import { t } from "ttag";
import _ from "underscore";

import { capitalize } from "metabase/lib/formatting";
import { color } from "metabase/lib/colors";
import { PLUGIN_FEATURE_LEVEL_PERMISSIONS } from "metabase/plugins";

import MetabaseSettings from "metabase/lib/settings";
import * as Urls from "metabase/lib/urls";
import Modal from "metabase/components/Modal";

import LogoIcon from "metabase/components/LogoIcon";
import EntityMenu from "metabase/components/EntityMenu";

// generate the proper set of list items for the current user
// based on whether they're an admin or not
export default class ProfileLink extends Component {
  state = {
    dropdownOpen: false,
  };

  static propTypes = {
    user: PropTypes.object.isRequired,
    handleCloseNavbar: PropTypes.func.isRequired,
  };

  openModal = modalName => {
    this.setState({ dropdownOpen: false, modalOpen: modalName });
  };

  closeModal = () => {
    this.setState({ modalOpen: null });
  };

  generateOptionsForUser = () => {
    const { tag } = MetabaseSettings.get("version");
    const { user, handleCloseNavbar } = this.props;
    const isAdmin = user.is_superuser;
    const canAccessSettings =
      isAdmin || PLUGIN_FEATURE_LEVEL_PERMISSIONS.canAccessSettings(user);

    return [
      {
        title: t`Account settings`,
        icon: null,
        link: Urls.accountSettings(),
        event: `Navbar;Profile Dropdown;Edit Profile`,
        onClose: handleCloseNavbar,
      },
      canAccessSettings && {
        title: t`Admin settings`,
        icon: null,
        link: "/admin",
        event: `Navbar;Profile Dropdown;Enter Admin`,
      },
      {
        title: t`Activity`,
        icon: null,
        link: "/activity",
        event: `Navbar;Profile Dropdown;Activity ${tag}`,
        onClose: handleCloseNavbar,
      },
      {
        title: t`Help`,
        icon: null,
        link:
          isAdmin && MetabaseSettings.isPaidPlan()
            ? "https://www.metabase.com/help-premium?utm_source=in-product&utm_medium=menu&utm_campaign=help"
            : "https://www.metabase.com/help?utm_source=in-product&utm_medium=menu&utm_campaign=help",

        externalLink: true,
        event: `Navbar;Profile Dropdown;About ${tag}`,
      },
      {
        title: t`About Metabase`,
        icon: null,
        action: () => this.openModal("about"),
        event: `Navbar;Profile Dropdown;About ${tag}`,
      },
      {
        title: t`Sign out`,
        icon: null,
        link: "auth/logout",
        event: `Navbar;Profile Dropdown;Logout`,
      },
    ].filter(Boolean);
  };

  render() {
    const { modalOpen } = this.state;
    const { tag, date, ...versionExtra } = MetabaseSettings.get("version");
    // don't show trademark if application name is whitelabeled
    const showTrademark = t`Metabase` === "Metabase";
    return (
      <div>
        <EntityMenu
          tooltip={t`Settings`}
          items={this.generateOptionsForUser()}
          triggerIcon="gear"
          triggerProps={{
            color: color("text-medium"),
            hover: {
              backgroundColor: color("brand"),
              color: color("text-white"),
            },
          }}
        />
        {modalOpen === "about" ? (
          <Modal small onClose={this.closeModal}>
            <div className="px4 pt4 pb2 text-centered relative">
              <div className="text-brand pb2">
                <LogoIcon height={48} />
              </div>
              <h2
                style={{ fontSize: "1.75em" }}
                className="text-dark"
              >{t`Thanks for using Metabase!`}</h2>
              <div className="pt2">
                <h3 className="text-dark mb1">
                  {t`You're on version`} {tag}
                </h3>
                <p className="text-medium text-bold">
                  {t`Built on`} {date}
                </p>
                {!/^v\d+\.\d+\.\d+$/.test(tag) && (
                  <div>
                    {_.map(versionExtra, (value, key) => (
                      <p key={key} className="text-medium text-bold">
                        {capitalize(key)}: {value}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {showTrademark && (
              <div
                style={{ borderWidth: "2px" }}
                className="p2 h5 text-centered text-medium border-top"
              >
                <span className="block">
                  <span className="text-bold">Metabase</span>{" "}
                  {t`is a Trademark of`} Metabase, Inc
                </span>
                <span>{t`and is built with care by a team from all across this pale blue dot.`}</span>
              </div>
            )}
          </Modal>
        ) : null}
      </div>
    );
  }
}
